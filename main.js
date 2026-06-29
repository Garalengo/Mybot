// 小袥袠袪: https://endway.org/@forch

const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
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
    const timestamp = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    const logEntry = `[${timestamp}] ${logMessage}\n`;
    try {
        fs.appendFileSync(logFilePath, logEntry);
        const data = fs.readFileSync(logFilePath, 'utf8');
        let lines = data.trim().split('\n');

        if (lines.length > maxLines) {
            lines = lines.slice(-maxLines);
            fs.writeFileSync(logFilePath, lines.join('\n') + '\n');
        }
    } catch (err) { }
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
            ['💰 Заработать', '🎵 Промокоды'],
            ['👇 Личный кабинет', '📙 Продвижение'],
            ['📳 Информация о боте']
        ],
        resize_keyboard: true
    };
} else {
    menu_keyboard = {
        keyboard: [
            ['💰 Заработать', '🎵 Промокоды'],
            ['👇 Личный кабинет', '📙 Продвижение'],
            ['📳 Информация о боте']
        ],
        resize_keyboard: true
    };
}

const bot = new TelegramBot(token, { polling: true });
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
        let title = 'Канал ' + (i + 1);
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
            await bot.sendMessage(chatId, 'Ошибка выполнения SQL-запроса.').catch(() => { })
        } else {
            if (rows && rows[0]) {
                const outputArray = [[...(Object.keys(rows[0]))], ...rows.map(obj => Object.values(obj))];
                for (let i = 0; i < outputArray.length; i++) {
                    for (let j = 0; j < outputArray[i].length; j++) {
                        if (outputArray[i][j] == null) {
                            await bot.sendMessage(chatId, 'Ошибка выполнения SQL-запроса.').catch(() => { })
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
                        await bot.sendMessage(chatId, chunk, { parse_mode: 'MarkdownV2' }).catch(() => { })
                    }
                } else {
                    await bot.sendMessage(chatId, '\`\`\`json\n' + result + '\n\`\`\`', { parse_mode: 'MarkdownV2' }).catch(() => { })
                }
            } else bot.sendMessage(chatId, 'Запрос выполнен, но он не вернул результатов.').catch(() => { })
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
                    }).catch(() => { });
                    db.run(`UPDATE users
                            SET verified = 1
                            WHERE chatId = ?`, [userId]);
                    db.run(`UPDATE users
                            SET balance = balance + ?
                            WHERE chatId = ?`, [refPrice, ref]);
                    await bot.sendMessage(ref, `💰 Начислено ${refPrice.toFixed(2)} ${config.currency} за верификацию реферала`).catch((err) => {
                        log(err.message)
                    });
                } else {
                    bot.sendMessage(chatId, config.subscribemsg.replace('%firstname%', firstName), {
                        parse_mode: 'HTML',
                        reply_markup: { inline_keyboard: subscriptions }
                    }).catch(() => { });
                }
                if (ref) {
                    bot.sendMessage(ref, `👁 У вас новый реферал ${username ? '@' + username : firstName} (1 ур.)`, { parse_mode: 'HTML' }).catch(() => { });
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
                    bot.sendMessage(row1.referer, `👁 У вас новый реферал ${username ? '@' + username : firstName} (2 ур.)`, { parse_mode: 'HTML' }).catch(() => { });
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
                    }).catch(() => { });
                    db.run(`UPDATE users
                            SET verified = 1
                            WHERE chatId = ?`, [userId]);
                } else {
                    bot.sendMessage(chatId, config.subscribemsg.replace('%firstname%', firstName), {
                        parse_mode: 'HTML',
                        reply_markup: { inline_keyboard: subscriptions }
                    }).catch(() => { });
                }
            }
        } else {
            const subscriptions = await checkSubscriptions(userId);
            if (subscriptions === true) {
                bot.sendMessage(chatId, config.hellomsg.replace('%firstname%', firstName), {
                    parse_mode: 'HTML',
                    reply_markup: menu_keyboard
                }).catch(() => { });
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
                        await bot.sendMessage(row1.referer, `💰 Вам начислено ${refPrice.toFixed(2)} ${config.currency} за реферала!`).catch((err) => {
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
                    reply_markup: { inline_keyboard: subscriptions }
                }).catch(() => { });
            }
        }
    });
    if (admin.includes(userId)) {
        bot.sendMessage(chatId, '👨‍💻 Админ-панель', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '📛 Заявки на выплату',
                            callback_data: 'withdraws'
                        }
                    ],
                    [
                        {
                            text: '📟 Запустить рассылку',
                            callback_data: 'broadcast'
                        }
                    ],
                    [
                        {
                            text: '💰 Изменить баланс юзеру',
                            callback_data: 'changebalance'
                        }
                    ],
                    [
                        {
                            text: '📵 Каналы для подписки',
                            callback_data: 'editchannels'
                        }
                    ],
                    [
                        {
                            text: '👪 Рефералы',
                            callback_data: 'adminreferals'
                        }
                    ],
                    [
                        {
                            text: '🎵 Создать промокод',
                            callback_data: 'adminpromocode'
                        }
                    ]
                ]
            }
        }).catch(() => { });
    }
});

async function checkSubscriptions(userId) {
    const required_channels = await update_channels();

    let keyboard = [];
    for (const ch of required_channels) {
        const chatm = await bot.getChatMember(ch[1], userId).catch(() => { });
        if (chatm && chatm.status === 'left') {
            keyboard.push([{ text: ch[2], url: ch[0] }]);
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
        const response = `📳 <b>Статистика нашего бота:</b>

👪 <b>Всего пользователей: </b>${totalUsers}
🧑‍💻 <b>Новых за сегодня: </b>${newUsers}

💰 <b>Всего выплачено: </b>${withdraws1} ${config.currency}
📅 <b>Мы работаем уже </b>${Math.floor((new Date() - new Date(config.startDate)) / (24 * 60 * 60 * 1000))} дней
`;
        bot.sendMessage(chatId, response, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '📙 Канал',
                            url: config.channel
                        },
                        {
                            text: '💬 Чат',
                            url: config.chat
                        },
                        {
                            text: '⭐ Отзывы',
                            url: config.reviews
                        }
                    ],
                    [
                        {
                            text: '📎 Правила',
                            url: config.rules
                        },
                        {
                            text: '❓ Задать вопрос',
                            url: 'tg://user?id=' + admin[0]
                        }
                    ],
                    [
                        {
                            text: '🏲 Топ рефералов за день',
                            callback_data: 'reftop_day'
                        }
                    ],
                    [
                        {
                            text: '🏳 Топ рефералов за всё время',
                            callback_data: 'reftop_all'
                        }
                    ]
                ]
            }
        }
        ).catch(() => { });
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

            const response = `📫 <b>Ваш кабинет:</b>
➖➖➖➖➖
👁 <b>Имя: <a href="tg://user?id=${userId}">${result.firstName}</a></b>
🔽 <b>ID:</b> <code>${userId}</code>
📅 <b>Дней в боте: ${daysInBot}</b>
➖➖➖➖➖
💰 <b>Баланс:</b>

• <b>💰 Текущий баланс: ${balance} ${config.currency}</b>
• <b>⌛ В процессе вывода: ${withdrawing} ${config.currency}</b>

• <b>💰 Всего заработано: ${withdrawed} ${config.currency}</b>`;
            bot.sendMessage(chatId, response, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '📜 Пополнить',
                                callback_data: 'replenish'
                            },
                            {
                                text: '📛 Вывести',
                                callback_data: 'withdraw'
                            }
                        ]
                    ]
                }
            }).catch(() => { });
        });
    } else {
        bot.sendMessage(chatId, config.subscribemsg.replace('%firstname%', msg.from.first_name), {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: subscriptions }
        }).catch(() => { });
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
            const response = `💰 <b>Партнёрская программа</b>
➖➖➖➖➖
🎵 <b>Действующие бонусы:</b>

– за 1 уровень:<b> ${refPrice} ${config.currency} </b>
– за 2 уровень:<b> ${refPrice2} ${config.currency} </b>

<i>⚠️ бонусы начисляются только после того, как реферал подпишется на все каналы бота в течение 5-и минут!</i>
➖➖➖➖➖
👪 <b>Ваши рефералы:</b>

– 1-го уровня: ${result.first_level_referrals}
– 2-го уровня: ${result.second_level_referrals}
➖➖➖➖➖
🔆 <b>Реф. ссылка:</b> https://t.me/${baseReferralUrl + '?start=' + userId}
➖➖➖➖➖
🗨 <b>Вас привёл ${result.refererUsername ? '@' + result.refererUsername : result.refererName}</b>
`;
            bot.sendMessage(chatId, response, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '📟 Поделиться ссылкой',
                                url: `https://t.me/share/url?url=https%3A//t.me/${baseReferralUrl}?start=${userId}`
                            }
                        ]
                    ]
                }
            }).catch(() => { });
        });
    } else {
        bot.sendMessage(chatId, config.subscribemsg.replace('%firstname%', msg.from.first_name), {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: subscriptions }
        }).catch(() => { });
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
                    bot.sendMessage(chatId, "В этом разделе Вы можете приобрести продвижение канала/чата для обязательной подписки, а также заказать рассылку Вашей рекламы по всему боту. Всё происходит автоматически. Наслаждайтесь!", {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    {
                                        text: '➡ Добавить канал',
                                        callback_data: 'addchannel'
                                    },
                                    {
                                        text: '🔄 Мои каналы',
                                        callback_data: 'listchannels'
                                    }
                                ],
                                [
                                    {
                                        text: '📟 Заказать рассылку в боте',
                                        callback_data: 'orderbroadcast'
                                    }
                                ]
                            ]
                        }
                    }).catch(() => { });
                } else {
                    bot.sendMessage(chatId, "Упс.. Уже добавлено максимальное количество каналов для подписки. Подождите, пока добавление вновь станет доступно.", {
                        parse_mode: 'HTML'
                    }).catch(() => { });
                }
            });

        } else {
            bot.sendMessage(chatId, config.subscribemsg.replace('%firstname%', msg.from.first_name), {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: subscriptions }
            }).catch(() => { });
        }
    });
bot.onText('🎵 Промокоды', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const subscriptions = await checkSubscriptions(userId);
    if (subscriptions === true) {
        await bot.sendMessage(chatId, '⭐ Введите промокод для активации:');
        promocodes.set(userId, {});
    } else {
        bot.sendMessage(chatId, config.subscribemsg.replace('%firstname%', msg.from.first_name), {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: subscriptions }
        }).catch(() => { });
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
                        bot.sendMessage(chatId, "💰 | Нужно ввести число. Попробуйте снова.", { parse_mode: 'HTML' }).catch(() => { });
                        return;
                    }
                    const amount = parseFloat(msg.text);
                    if (amount < minAmount) {
                        bot.sendMessage(chatId, "💰 | Мин. сумма: " + minAmount, { parse_mode: 'HTML' }).catch(() => { });
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
                            bot.sendMessage(chatId, "💰 | Макс. сумма: " + row.balance, { parse_mode: 'HTML' }).catch(() => { });
                            return;
                        }
                        withdraws.set(userId, { amount: amount, wallet: undefined });
                        bot.sendMessage(chatId, "💰 | Введите реквизиты для вывода (Карта, СБП, Криптокошелёк и др. с уточнением Банка, Сети и прочей информации):", { parse_mode: 'HTML' }).catch(() => { });
                    });

                } else if (!withdraws.get(userId).wallet) {
                    withdraws.set(userId, { amount: withdraws.get(userId).amount, wallet: msg.text });
                    bot.sendMessage(chatId, '💰 | Введите те же самые реквизиты для подтверждения вывода (для удобства скопируйте ранее отправленный текст):', { parse_mode: 'HTML' }).catch(() => { });
                } else {
                    if (msg.text !== withdraws.get(userId).wallet) {
                        bot.sendMessage(chatId, "❌ Реквизиты не повторяются. Проверьте данные и попробуйте снова.", { parse_mode: 'HTML' }).catch(() => { });
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
                            bot.sendMessage(chatId, '❌ Недостаточный баланс для совершения выбранного действия. Проверьте данные и попробуйте снова.', { parse_mode: 'HTML' }).catch(() => { });
                            withdraws.delete(userId);
                            return;
                        }
                        db.run(`INSERT INTO withdraws(chatId, amount, wallet)
                                VALUES (?, ?, ?)`, [userId, amount, wallet]);
                        db.run(`UPDATE users
                                SET balance = balance + ?
                                WHERE chatId = ?`, [-amount, userId]);
                        bot.sendMessage(chatId, '✅ Заявка на выплату создана.\n\n💰 Сумма вывода: ' + amount + '\n💰 Реквизиты: ' + wallet + '\n\n⏳ Время ожидания: до 72 часов').catch(() => { });
                        bot.sendMessage(admin[0], '⚠️ Поступила заявка на выплату.').catch(() => { });
                        withdraws.delete(userId)
                    });
                }
            } else if (addchannel.has(userId)) {
                if (!addchannel.get(userId).hours) {
                    if (isNaN(msg.text)) {
                        bot.sendMessage(chatId, "💰 | Нужно ввести число").catch(() => { });
                        return;
                    }
                    const hours = parseFloat(msg.text);
                    if (hours < 1) {
                        bot.sendMessage(chatId, "💰 | Мин. срок: от 1 часа").catch(() => { });
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
                            bot.sendMessage(chatId, `❌ Недостаточный баланс ${hours} * ${priceperhour} > ${row.balance}`).catch(() => { });
                            return;
                        }
                        addchannel.set(userId, {
                            hours: hours,
                            channel: undefined,
                            name: undefined
                        });
                        bot.sendMessage(chatId, "💰 | Отправьте @username канала.").catch(() => { });
                    });

                } else if (!addchannel.get(userId).channel) {
                    const chat = await bot.getChat('@' + msg.text.trim().replace("@", "").replace("https://t.me/", "").replace("http://t.me/", "").replace("t.me/", "").replace("/", "")).catch(() => { });
                    if (!chat) {
                        bot.sendMessage(chatId, "💰 | Наш бот должен быть администратором канала/чата для автоматической проверки подписок.").catch(() => { });
                        return;
                    }
                    const chatmember = await bot.getChatMember('@' + msg.text, userId).catch(() => { });
                    if (!chatmember) {
                        bot.sendMessage(chatId, "💰 | Наш бот должен быть администратором канала/чата для автоматической проверки подписок.").catch(() => { });
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
                                bot.sendMessage(chatId, '✅ Канал успешно добавлен!').catch(() => { });
                            });

                        } else {
                            bot.sendMessage(chatId, "❌ Уже добавлено максимальное количество каналов для подписки. Подождите, пока добавление не станет снова доступно", {
                                parse_mode: 'HTML'
                            }).catch(() => { });
                        }
                    });

                }
            } else if (broadcasts.has(userId)) {
                if (!broadcasts.get(userId).auditory) {
                    if (isNaN(msg.text)) {
                        bot.sendMessage(chatId, "💰 | Нужно ввести число").catch(() => { });
                        return;
                    }
                    const auditory = parseInt(msg.text);

                    broadcasts.set(userId, {
                        auditory: auditory,
                        msg: undefined
                    });
                    bot.sendMessage(chatId, "⏳ | Отправьте сообщение для рассылки").catch(() => { });

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
                        bot.sendMessage(chatId, "❌ Нужно ввести число").catch(() => { });
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
                            bot.sendMessage(chatId, "❌ Недостаточно баланса. Проверьте все данные и повторите попытку.").catch(() => { });
                            return;
                        }
                        orderbroadcasts.set(userId, {
                            auditory: auditory,
                            msg: undefined
                        });
                        bot.sendMessage(chatId, "⏳ | Отправьте сообщение для рассылки").catch(() => { });
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
                                bot.sendMessage(chatId, "Пользователь не найден").catch(() => { });
                            } else {
                                bot.sendMessage(chatId, `Баланс пользователя ${row.username ? '@' + row.username : row.firstName} изменён на ${dif}р.\nНовый баланс: ${row.balance}`, { parse_mode: "HTML" }).catch(() => { });
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
                            bot.sendMessage(chatId, "Рефералы не найдены").catch(() => { });
                            return;
                        }
                        let text = '';
                        rows.forEach(row => {
                            text += '<b>' + row.chatId + '</b> (' + row.firstName + ') ' + (row.username ? '@' + row.username + ' ' : '') + (row.verified === 1 ? '✅' : '❌') + ' <b>' + row.balance.toFixed(2) + '₽</b>\n'
                        })
                        bot.sendMessage(chatId, "Рефералы пользователя (первые " + rows.length + ") ℹ" + msg.text + ":\n" + text, { parse_mode: 'HTML' }).catch(() => { });
                    })
                } else {
                    bot.sendMessage(chatId, "Нужно ввести число.").catch(() => { });
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
                        bot.sendMessage(chatId, "Промокод не найден или уже активирован").catch(() => { });
                        return;
                    }
                    db.run(`INSERT OR IGNORE INTO promocodeactivations(userId, hash)
                            VALUES (?, ?)`, [userId, msg.text]);
                    db.run(`UPDATE users
                            SET balance = balance + ?
                            WHERE chatId = ?`, [row.sum, userId]);
                    await bot.sendMessage(userId, '✅ Промокод активирован: <b>+' + row.sum.toFixed(2) + ' ' + config.currency + '</b>', { parse_mode: 'HTML' }).catch(() => { });
                    await bot.sendMessage(admin[0], '⚠️ Промокод <b>' + msg.text + '</b> активирован пользователем <b>' + userId + '</b>', { parse_mode: 'HTML' }).catch((err) => {
                        log(err.message)
                    });
                })
            } else if (adminpromocode.has(userId)) {
                if (!admin.includes(userId)) return;
                const promo = adminpromocode.get(userId);
                if (!promo.sum) {
                    if (isNaN(msg.text)) {
                        bot.sendMessage(chatId, "❌ Нужно ввести число").catch(() => { });
                        return;
                    }
                    promo.sum = parseFloat(msg.text);
                    await bot.sendMessage(userId, '💰 | Введите количество активаций:');
                } else if (!promo.activations) {
                    if (isNaN(msg.text)) {
                        bot.sendMessage(chatId, "❌ Нужно ввести число").catch(() => { });
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
                        await bot.sendMessage(userId, `Промокод на сумму ${promo.sum.toFixed(2)} ${config.currency} и ${promo.activations} активаций создан: <code>` + promo.hash + '</code>', { parse_mode: 'HTML' });
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
        log(userId + ' отправил обратную связь: ' + msg.data);

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
                        bot.sendMessage(chatId, "❌ Мин. сумма вывода: " + minAmount).catch(() => { });
                        return;
                    }
                    withdraws.set(userId, { amount: undefined, wallet: undefined });
                    bot.sendMessage(chatId, "💰 | Введите сумму от " + minAmount + " до " + row.balance + ":").catch(() => { });
                });
                break;
            }
            case 'replenish': {
                bot.sendMessage(chatId, config.replenish.replaceAll("{id}", userId), { parse_mode: 'HTML' }).catch(() => { });
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
                            bot.sendMessage(chatId, "❌ Нет заявок на выплату").catch(() => { });
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
                                    bot.sendMessage(chatId, `Всего заявок на выплату: ${count}\nПропущено: ${current_withdraw_offset}\n\nПользователь: ${row.username ? '@' + row.username : row.firstName}\nСумма: ${row1.amount}\nРеквизиты: <code>${row1.wallet}</code>`,
                                        {
                                            parse_mode: 'HTML',
                                            reply_markup: {
                                                inline_keyboard: [
                                                    [
                                                        {
                                                            text: '⏳ Пропустить',
                                                            callback_data: 'withdraws_skip'
                                                        }
                                                    ],
                                                    [
                                                        {
                                                            text: '✅ Выплатить',
                                                            callback_data: 'acceptwithdraw_' + row1.id
                                                        }
                                                    ],
                                                    [
                                                        {
                                                            text: '❌ Отказать',
                                                            callback_data: 'declinewithdraw_' + row1.id
                                                        }
                                                    ]
                                                ]
                                            }
                                        }
                                    ).catch(() => { });
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
                    bot.sendMessage(row.chatId, "✅ Ваша заявка на вывод была успешно обработана. \n\nСумма " + row.amount + " успешно выплачена на реквизиты:" + row.wallet).catch(() => { });
                    bot.sendMessage(config.withdraws, `📵 <b><a href="tg://user?id=${row.chatId}">пользователь</a> вывел ${row.amount} ${config.currency}</b>`, { parse_mode: 'HTML' }).catch(() => { });
                    bot.sendMessage(admin[0], "Сообщение об успешной выплате отправлено.", {
                        reply_markup: {
                            inline_keyboard: [[{
                                text: '📛 Заявки на выплату',
                                callback_data: 'withdraws'
                            }]]
                        }
                    }).catch(() => { });
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
                    bot.sendMessage(row.chatId, row.amount + " не было выплачено на " + row.wallet).catch(() => { });
                    bot.sendMessage(admin[0], "Сообщение о невыплате отправлено", {
                        reply_markup: {
                            inline_keyboard: [[{
                                text: '📛 Заявки на выплату',
                                callback_data: 'withdraws'
                            }]]
                        }
                    }).catch(() => { });
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
                        bot.sendMessage(chatId, "💰 | Отправьте срок, на который хотите заказать продвижение (в часах).").catch(() => { });
                    } else
                        bot.sendMessage(chatId, "Упс.. Уже добавлено максимальное количество каналов для подписки. Подождите, пока добавление не станет снова доступно", {
                            parse_mode: 'HTML'
                        }).catch(() => { });
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
                        let message = "Ваши каналы:"
                        for (const row of rows) {
                            message += "\n@" + row.channel + " Дата создания: " + row.creationDate + " Срок: " + row.hours + " часов";
                        }
                        bot.sendMessage(chatId, message).catch(() => { });
                    } else
                        bot.sendMessage(chatId, "Нет каналов", {
                            parse_mode: 'HTML'
                        }).catch(() => { });
                });
                break;
            }
            case 'broadcast': {
                if (admin.includes(userId)) {
                    if (data[1]) {
                        if (data[1] === 'confirm') {
                            const msg = JSON.parse(JSON.stringify(broadcasts.get(userId).msg));
                            const auditory = JSON.parse(JSON.stringify(broadcasts.get(userId).auditory));
                            bot.sendMessage(chatId, "✅ Рассылка запущена").catch(() => { });
                            broadcastMessage(msg, auditory);

                            broadcasts.delete(userId);
                        } else {
                            bot.sendMessage(chatId, "Отменено").catch(() => { });
                            broadcasts.delete(userId);
                        }
                    } else {
                        broadcasts.set(userId, {
                            auditory: undefined,
                            msg: undefined
                        });
                        bot.sendMessage(chatId, "⚠️ Введите аудиторию (количество человек):").catch(() => { });
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
                                bot.sendMessage(chatId, "❌ Недостаточно баланс").catch(() => { });
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
                        bot.sendMessage(chatId, "Отменено").catch(() => { });
                        orderbroadcasts.delete(userId);
                    }

                } else {
                    orderbroadcasts.set(userId, {
                        auditory: undefined,
                        msg: undefined
                    });
                    bot.sendMessage(chatId, "⚠️ Введите аудиторию (количество человек).\nТекущий курс: " + priceperuser + +" " + config.currency + " за человека").catch(() => { });
                }

                break;
            }
            case 'changebalance': {
                if (admin.includes(userId)) {
                    adminfuncs.set(userId, {
                        func: "changebalance"
                    });
                    bot.sendMessage(chatId, "💰 | Введите ID пользователя и сумму, на которую нужно изменить баланс через пробел\nНапример: 1234567890 -10.5").catch(() => { });
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
                            keyboard.push([{ text: row.title, callback_data: 'editchannel_' + row.id }]);
                        }
                        bot.sendMessage(chatId, "📷 Текущие каналы:", { reply_markup: { inline_keyboard: keyboard } }).catch(() => { });
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
                        bot.sendMessage(chatId, "Заголовок: " + row.title + "\nКанал: https://t.me/" + row.channel, {
                            reply_markup: {
                                inline_keyboard: [[{
                                    text: '🗑 Удалить',
                                    callback_data: 'deletechannel_' + row.id
                                }]]
                            }
                        }).catch(() => { });
                    });
                }
                break;
            }
            case 'deletechannel': {
                if (admin.includes(userId)) {
                    db.run(`DELETE
                            FROM subscriptions
                            WHERE id = ?`, [parseInt(data[1])]);
                    bot.sendMessage(chatId, "🗑 Канал удалён").catch(() => { });
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
                            let message = '🏳 Топ рефералов за всё время:\n';

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
                            let message = '🏲 Топ рефералов за сегодня:\n';

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
                await bot.sendMessage(userId, 'Введите ID пользователя для просмотра:')
                break;
            }
            case 'adminpromocode': {
                adminpromocode.set(userId, {});
                await bot.sendMessage(userId, '⭐ Введите сумму промокода:')
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
            if (order) msg_b_text = "⚠️#реклама\n" + msg_b_text;
            for (const row of rows) {
                bot.sendMessage(row.chatId, msg_b_text, msg_b_form).catch(() => {
                    counter++;
                }).catch(() => { });
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
        bot.sendMessage(firstChatId, '✅ Рассылка завершена').catch(() => { });
        bot.sendMessage(admin[0], '💄 Не доставлено: ' + counter).catch(() => { });
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
            text: 'Подтвердить',
            callback_data: 'orderbroadcast_confirm'
        }, { text: 'Отклонить', callback_data: 'orderbroadcast_decline' }]);
    else
        msg_b_form.reply_markup.inline_keyboard.push([{
            text: 'Подтвердить',
            callback_data: 'broadcast_confirm'
        }, { text: 'Отклонить', callback_data: 'broadcast_decline' }]);
    let counter = 0;
    if (msg.text) {
        const msg_b_text = msg_b.text;


        bot.sendMessage(userId, msg_b_text, msg_b_form).catch(() => {
            counter++;
        }).catch(() => { });

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
        keyboardButtons.push([{ text: buttonName, url: buttonUrl }]);
    }

    const keyboard = {
        inline_keyboard: keyboardButtons,
    };
    const text = message.replace(buttonRegex, '');
    const options = { ...form, reply_markup: keyboard };
    if (options.caption) {
        options.caption = text;
    }
    return { text: text, form: options };
}

bot.on('polling_error', (error) => {
    log('Polling error:', error);
});

process.on('SIGTERM', () => {
    process.exit();
})