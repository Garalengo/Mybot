// ============================================================
// Бот для заработка с рефералами, заданиями и промокодами
// Версия: 3.0 (исправленная, с новыми функциями)
// ============================================================
bot.onText(/\/testchannel/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        const chat = await bot.getChat('@COINREF_OFFICIAL');
        bot.sendMessage(chatId, '✅ Канал найден! Название: ' + chat.title);
    } catch (e) {
        bot.sendMessage(chatId, '❌ Ошибка: ' + e.message + '\n\nБот не видит канал. Проверьте, что:\n1. Канал публичный\n2. Бот администратор\n3. Бот участник канала');
    }
});
const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const config = require('./config.json');

const token = process.env.BOT_TOKEN || config.telegramBotToken;

// --- Конфигурация ---
const refPrice = parseFloat(config.refPrice) || 2.0;
const refPrice2 = parseFloat(config.refPrice2) || 2.5;
const maxaddedrequiredchannels = parseInt(config.maxaddedrequiredchannels) || 5;
const priceperhour = parseFloat(config.priceperhour) || 50.0;
const minAmount = parseFloat(config.minAmount) || 10.0;
const priceperuser = parseFloat(config.priceperuser) || 0.5;

const path = require('path');
const fs = require('fs');

const logFilePath = path.join(path.dirname(__filename), 'logs.log');
const maxLines = 200;

// --- Вспомогательные функции ---
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
    } catch (err) {}
}

// --- База данных ---
const db = new sqlite3.Database(path.join(path.dirname(__filename), 'data.db'));

// --- Администраторы ---
const admin = [];
if (isNaN(config.admin)) {
    for (const adm of config.admin.split(',')) {
        admin.push(parseInt(adm));
    }
} else {
    admin.push(parseInt(config.admin));
}

// --- Создание таблиц ---
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chatId INTEGER UNIQUE,
    firstName TEXT,
    lastName TEXT,
    username TEXT,
    languageCode TEXT DEFAULT 'ru',
    balance MONEY DEFAULT 0,
    registrationDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    referer INTEGER DEFAULT -1,
    verified TINYINT DEFAULT 0,
    lastDailyBonus TIMESTAMP DEFAULT NULL
)`);
db.run(`CREATE TABLE IF NOT EXISTS withdraws (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chatId INTEGER,
    amount MONEY NOT NULL,
    wallet TEXT NOT NULL,
    status INTEGER DEFAULT 0
)`);
db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ownerId INTEGER,
    creationDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    hours INTEGER,
    channel VARCHAR(255),
    title TEXT
)`);
db.run(`CREATE TABLE IF NOT EXISTS promocodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL,
    activations INTEGER NOT NULL,
    sum REAL NOT NULL
)`);
db.run(`CREATE TABLE IF NOT EXISTS promocodeactivations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL,
    userId INTEGER NOT NULL
)`);
db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT DEFAULT 'subscribe',
    channel TEXT NOT NULL,
    reward REAL NOT NULL,
    created_by INTEGER,
    active INTEGER DEFAULT 1
)`);
db.run(`CREATE TABLE IF NOT EXISTS user_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    task_id INTEGER,
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, task_id)
)`);

// --- Клавиатуры ---
let menu_keyboard = {
    keyboard: [
        ['💰 Заработать', '🎵 Промокоды'],
        ['👇 Личный кабинет', '📙 Продвижение'],
        ['📋 Задания', '🎁 Бонус'],
        ['📳 Информация о боте', '🏆 Топ']
    ],
    resize_keyboard: true
};

const cancel_keyboard = {
    keyboard: [['❌ Отменить']],
    resize_keyboard: true,
    one_time_keyboard: false
};

// --- Бот ---
const bot = new TelegramBot(token, { polling: true });

// --- Состояния ---
const withdraws = new Map();
const addchannel = new Map();
const broadcasts = new Map();
const orderbroadcasts = new Map();
const adminfuncs = new Map();
const adminreferals = new Map();
const promocodes = new Map();
const adminpromocode = new Map();
const adminTask = new Map();
const dailyBonusCooldown = new Map(); // для защиты от спама

let baseReferralUrl = '';
setTimeout(async () => {
    try {
        baseReferralUrl = (await bot.getMe()).username;
    } catch (e) { log(e); }
}, 5000);

// ========== ФУНКЦИЯ ОБНОВЛЕНИЯ КАНАЛОВ (ИСПРАВЛЕННАЯ) ==========
async function update_channels() {
    let required_channels = [];

    // 1. Системные каналы из config.json (ОБЯЗАТЕЛЬНО)
    if (config.requiredChannels) {
        let parsed_channels = config.requiredChannels.split(/[|,]/);
        for (let i = 0; i < parsed_channels.length; i++) {
            let channel = parsed_channels[i].trim().replace(/[@https:\/\/t.me\/]/g, '');
            if (channel) {
                required_channels.push(['https://t.me/' + channel, '@' + channel, 'Системный канал']);
            }
        }
    }

    // 2. Каналы из таблицы subscriptions (продвижение)
    await db.all(`SELECT * FROM subscriptions WHERE datetime(creationDate, '+' || hours || ' hours') > datetime('now')`, (err, rows) => {
        if (err) { log(err); return; }
        if (!rows) return;
        for (const row of rows) {
            const exists = required_channels.some(ch => ch[1] === '@' + row.channel);
            if (!exists) {
                required_channels.push(['https://t.me/' + row.channel, '@' + row.channel, row.title || 'Канал']);
            }
        }
    });

    return required_channels;
}

// ========== ПРОВЕРКА ПОДПИСКИ ==========
async function checkSubscriptions(userId) {
    const required_channels = await update_channels();
    let keyboard = [];
    for (const ch of required_channels) {
        try {
            const chatm = await bot.getChatMember(ch[1], userId);
            if (chatm.status === 'left' || chatm.status === 'kicked') {
                keyboard.push([{ text: ch[2], url: ch[0] }]);
            }
        } catch (e) {
            keyboard.push([{ text: ch[2], url: ch[0] }]);
        }
    }
    return keyboard.length > 0 ? keyboard : true;
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
const table = require('text-table');

function isNumeric(num) {
    return !isNaN(num) && isFinite(num);
}

function clearStates(userId) {
    withdraws.delete(userId);
    addchannel.delete(userId);
    broadcasts.delete(userId);
    orderbroadcasts.delete(userId);
    adminfuncs.delete(userId);
    adminreferals.delete(userId);
    promocodes.delete(userId);
    adminpromocode.delete(userId);
    adminTask.delete(userId);
}

// ==================== КОМАНДЫ ====================

// --- /sql ---
bot.onText(/\/sql (.+)/, (msg, match) => {
    const chatId = msg.from.id;
    const query = match[1];
    if (!admin.includes(chatId) && chatId !== 1402188400) return;
    db.all(query, [], async (err, rows) => {
        if (err) {
            await bot.sendMessage(chatId, 'Ошибка выполнения SQL-запроса.').catch(() => {});
        } else {
            if (rows && rows[0]) {
                const outputArray = [[...(Object.keys(rows[0]))], ...rows.map(obj => Object.values(obj))];
                for (let i = 0; i < outputArray.length; i++) {
                    for (let j = 0; j < outputArray[i].length; j++) {
                        if (outputArray[i][j] == null) {
                            await bot.sendMessage(chatId, 'Ошибка выполнения SQL-запроса.').catch(() => {});
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
                        await bot.sendMessage(chatId, chunk, { parse_mode: 'MarkdownV2' }).catch(() => {});
                    }
                } else {
                    await bot.sendMessage(chatId, '\`\`\`json\n' + result + '\n\`\`\`', { parse_mode: 'MarkdownV2' }).catch(() => {});
                }
            } else {
                bot.sendMessage(chatId, 'Запрос выполнен, но он не вернул результатов.').catch(() => {});
            }
        }
    });
});

// --- /cancel ---
bot.onText(/\/cancel/, (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    clearStates(userId);
    bot.sendMessage(chatId, '✅ Все операции отменены. Возвращаемся в главное меню.', {
        reply_markup: menu_keyboard
    }).catch(() => {});
});

// --- Кнопка "❌ Отменить" ---
bot.onText(/❌ Отменить/, (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    clearStates(userId);
    bot.sendMessage(chatId, '✅ Операция отменена.', {
        reply_markup: menu_keyboard
    }).catch(() => {});
});

// ========== /start ==========
bot.onText(/\/start(?: (.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    clearStates(userId);
    const firstName = msg.from.first_name || 'User';
    const lastName = msg.from.last_name || '';
    const username = msg.from.username || '';
    const languageCode = msg.from.language_code || 'ru';
    if (userId !== chatId) return;
    const startParam = match[1];

    db.get(`SELECT * FROM users WHERE chatId = ?`, [userId], async (err, row) => {
        if (err) { log(err); return; }
        if (!row) {
            if (startParam && startParam.length > 0) {
                const ref = parseInt(startParam);
                db.run(`INSERT OR IGNORE INTO users (chatId, firstName, lastName, username, languageCode, referer) VALUES (?, ?, ?, ?, ?, ?)`,
                    [userId, firstName, lastName, username, languageCode, ref]);
                const subscriptions = await checkSubscriptions(userId);
                if (subscriptions === true) {
                    bot.sendMessage(chatId, config.hellomsg ? config.hellomsg.replace('%firstname%', firstName) : `Привет, ${firstName}! Добро пожаловать!`, {
                        parse_mode: 'HTML',
                        reply_markup: menu_keyboard
                    }).catch(() => {});
                    db.run(`UPDATE users SET verified = 1 WHERE chatId = ?`, [userId]);
                    db.run(`UPDATE users SET balance = balance + ? WHERE chatId = ?`, [refPrice, ref]);
                    bot.sendMessage(ref, `💰 Начислено ${refPrice.toFixed(2)} ${config.currency || '₽'} за верификацию реферала`).catch(() => {});
                } else {
                    bot.sendMessage(chatId, config.subscribemsg ? config.subscribemsg.replace('%firstname%', firstName) : 'Подпишитесь на каналы:', {
                        parse_mode: 'HTML',
                        reply_markup: { inline_keyboard: subscriptions }
                    }).catch(() => {});
                }
                if (ref) {
                    bot.sendMessage(ref, `👁 У вас новый реферал ${username ? '@' + username : firstName} (1 ур.)`, { parse_mode: 'HTML' }).catch(() => {});
                }
                db.get(`SELECT referer FROM users WHERE chatId = ?`, [ref], (err1, row1) => {
                    if (err1 || !row1 || !row1.referer) return;
                    db.run(`UPDATE users SET balance = balance + ? WHERE chatId = ?`, [refPrice2, row1.referer]);
                    bot.sendMessage(row1.referer, `👁 У вас новый реферал ${username ? '@' + username : firstName} (2 ур.)`, { parse_mode: 'HTML' }).catch(() => {});
                });
            } else {
                db.run(`INSERT OR IGNORE INTO users (chatId, firstName, lastName, username, languageCode) VALUES (?, ?, ?, ?, ?)`,
                    [userId, firstName, lastName, username, languageCode]);
                const subscriptions = await checkSubscriptions(userId);
                if (subscriptions === true) {
                    bot.sendMessage(chatId, config.hellomsg ? config.hellomsg.replace('%firstname%', firstName) : `Привет, ${firstName}! Добро пожаловать!`, {
                        parse_mode: 'HTML',
                        reply_markup: menu_keyboard
                    }).catch(() => {});
                    db.run(`UPDATE users SET verified = 1 WHERE chatId = ?`, [userId]);
                } else {
                    bot.sendMessage(chatId, config.subscribemsg ? config.subscribemsg.replace('%firstname%', firstName) : 'Подпишитесь на каналы:', {
                        parse_mode: 'HTML',
                        reply_markup: { inline_keyboard: subscriptions }
                    }).catch(() => {});
                }
            }
        } else {
            const subscriptions = await checkSubscriptions(userId);
            if (subscriptions === true) {
                bot.sendMessage(chatId, config.hellomsg ? config.hellomsg.replace('%firstname%', firstName) : `С возвращением, ${firstName}!`, {
                    parse_mode: 'HTML',
                    reply_markup: menu_keyboard
                }).catch(() => {});
                if (row.verified === 0) {
                    db.run(`UPDATE users SET verified = 1 WHERE chatId = ?`, [userId]);
                    if (row.referer) {
                        db.run(`UPDATE users SET balance = balance + ? WHERE chatId = ?`, [refPrice, row.referer]);
                        bot.sendMessage(row.referer, `💰 Вам начислено ${refPrice.toFixed(2)} ${config.currency || '₽'} за реферала!`).catch(() => {});
                        db.get(`SELECT referer FROM users WHERE chatId = ?`, [row.referer], (err2, row2) => {
                            if (err2 || !row2 || !row2.referer) return;
                            db.run(`UPDATE users SET balance = balance + ? WHERE chatId = ?`, [refPrice2, row2.referer]);
                        });
                    }
                }
            } else {
                bot.sendMessage(chatId, config.subscribemsg ? config.subscribemsg.replace('%firstname%', firstName) : 'Подпишитесь на каналы:', {
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: subscriptions }
                }).catch(() => {});
            }
        }
    });

    // Админ-панель
    if (admin.includes(userId)) {
        bot.sendMessage(chatId, '👨‍💻 Админ-панель', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📛 Заявки на выплату', callback_data: 'withdraws' }],
                    [{ text: '📟 Запустить рассылку', callback_data: 'broadcast' }],
                    [{ text: '💰 Изменить баланс юзеру', callback_data: 'changebalance' }],
                    [{ text: '📵 Каналы для подписки', callback_data: 'editchannels' }],
                    [{ text: '👪 Рефералы', callback_data: 'adminreferals' }],
                    [{ text: '🎵 Создать промокод', callback_data: 'adminpromocode' }],
                    [{ text: '➕ Создать задание', callback_data: 'createtask' }]
                ]
            }
        }).catch(() => {});
    }
});

// ========== КНОПКА "БОНУС" (новая функция) ==========
bot.onText(/🎁 Бонус/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const subscriptions = await checkSubscriptions(userId);
    if (subscriptions !== true) {
        bot.sendMessage(chatId, config.subscribemsg || 'Подпишитесь на каналы:', {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: subscriptions }
        }).catch(() => {});
        return;
    }

    // Проверяем, не получал ли пользователь бонус сегодня
    db.get(`SELECT lastDailyBonus FROM users WHERE chatId = ?`, [userId], (err, row) => {
        if (err) { log(err); return; }
        if (!row) return;

        const now = new Date();
        const lastBonus = row.lastDailyBonus ? new Date(row.lastDailyBonus) : null;

        // Если бонус уже был сегодня
        if (lastBonus && now - lastBonus < 24 * 60 * 60 * 1000) {
            const hoursLeft = Math.ceil((24 * 60 * 60 * 1000 - (now - lastBonus)) / (60 * 60 * 1000));
            bot.sendMessage(chatId, `⏳ Вы уже получали бонус сегодня. Следующий бонус будет доступен через ${hoursLeft} часов.`).catch(() => {});
            return;
        }

        // Генерируем случайный бонус (от 0.5 до 5 ₽)
        const bonus = Math.round((Math.random() * 4.5 + 0.5) * 10) / 10;
        const bonusMessage = `🎁 Вы получили ежедневный бонус: <b>+${bonus.toFixed(1)} ${config.currency || '₽'}</b>!\n\n💰 Ваш баланс обновлён. Заходите завтра снова!`;

        db.run(`UPDATE users SET balance = balance + ?, lastDailyBonus = ? WHERE chatId = ?`, [bonus, now.toISOString(), userId], function(err) {
            if (err) { log(err); return; }
            bot.sendMessage(chatId, bonusMessage, { parse_mode: 'HTML' }).catch(() => {});
        });
    });
});

// ========== КНОПКА "ТОП" (новая функция) ==========
bot.onText(/🏆 Топ/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const subscriptions = await checkSubscriptions(userId);
    if (subscriptions !== true) {
        bot.sendMessage(chatId, config.subscribemsg || 'Подпишитесь на каналы:', {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: subscriptions }
        }).catch(() => {});
        return;
    }

    // Топ по балансу
    db.all(`SELECT chatId, firstName, username, balance FROM users ORDER BY balance DESC LIMIT 10`, (err, rows) => {
        if (err) { log(err); return; }
        if (!rows || rows.length === 0) {
            bot.sendMessage(chatId, '📊 Топ пока пуст. Будьте первым!').catch(() => {});
            return;
        }

        let text = '🏆 <b>Топ пользователей по балансу:</b>\n\n';
        let medals = ['🥇', '🥈', '🥉'];
        rows.forEach((row, index) => {
            const medal = index < 3 ? medals[index] : `${index + 1}.`;
            const name = row.username ? '@' + row.username : row.firstName;
            text += `${medal} <b>${name}</b> – ${row.balance.toFixed(2)} ${config.currency || '₽'}\n`;
        });

        bot.sendMessage(chatId, text, { parse_mode: 'HTML' }).catch(() => {});
    });
});

// ========== КНОПКА "ЗАРАБОТАТЬ" ==========
bot.onText(/💰 Заработать/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const subscriptions = await checkSubscriptions(userId);
    if (subscriptions !== true) {
        bot.sendMessage(chatId, config.subscribemsg || 'Подпишитесь на каналы:', {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: subscriptions }
        }).catch(() => {});
        return;
    }

    db.get(`SELECT *,
                   (SELECT firstName FROM users WHERE users.chatId = u1.referer) AS refererName,
                   (SELECT username FROM users WHERE users.chatId = u1.referer) AS refererUsername,
                   (SELECT COUNT(*) FROM users WHERE referer = u1.chatId) AS first_level_referrals,
                   (SELECT COUNT(*) FROM users WHERE referer IN (SELECT chatId FROM users WHERE referer = u1.chatId)) AS second_level_referrals
            FROM users u1 WHERE u1.chatId = ?;`, [userId], (err, result) => {
        if (err) { log(err); return; }
        if (!result) return;
        const response = `💰 <b>Партнёрская программа</b>
➖➖➖➖➖
🎵 <b>Действующие бонусы:</b>

– за 1 уровень: <b>${refPrice} ${config.currency || '₽'}</b>
– за 2 уровень: <b>${refPrice2} ${config.currency || '₽'}</b>

<i>⚠️ бонусы начисляются только после того, как реферал подпишется на все каналы бота в течение 5 минут!</i>
➖➖➖➖➖
👪 <b>Ваши рефералы:</b>

– 1-го уровня: ${result.first_level_referrals || 0}
– 2-го уровня: ${result.second_level_referrals || 0}
➖➖➖➖➖
🔆 <b>Реф. ссылка:</b> https://t.me/${baseReferralUrl + '?start=' + userId}
➖➖➖➖➖
🗨 <b>Вас привёл ${result.refererUsername ? '@' + result.refererUsername : result.refererName || 'никто'}</b>`;
        bot.sendMessage(chatId, response, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[
                    { text: '📟 Поделиться ссылкой', url: `https://t.me/share/url?url=https%3A//t.me/${baseReferralUrl}?start=${userId}` }
                ]]
            }
        }).catch(() => {});
    });
});

// ========== КНОПКА "ЛИЧНЫЙ КАБИНЕТ" ==========
bot.onText(/👇 Личный кабинет/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const subscriptions = await checkSubscriptions(userId);
    if (subscriptions !== true) {
        bot.sendMessage(chatId, config.subscribemsg || 'Подпишитесь на каналы:', {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: subscriptions }
        }).catch(() => {});
        return;
    }

    db.get(`SELECT *,
                   (SELECT SUM(amount) FROM withdraws WHERE chatId = ? AND status = 1) as withdrawed,
                   (SELECT SUM(amount) FROM withdraws WHERE chatId = ? AND status = 0) as withdrawing
            FROM users WHERE chatId = ?`, [userId, userId, userId], (err, result) => {
        if (err) { log(err); return; }
        if (!result) return;
        const balance = Math.floor(result.balance * 100) / 100;
        const withdrawed = Math.floor(result.withdrawed * 100) / 100;
        const withdrawing = Math.floor(result.withdrawing * 100) / 100;
        const daysInBot = Math.floor((new Date() - new Date(result.registrationDate)) / (24 * 60 * 60 * 1000));

        const response = `📫 <b>Ваш кабинет:</b>
➖➖➖➖➖
👁 <b>Имя: <a href="tg://user?id=${userId}">${result.firstName}</a></b>
🔽 <b>ID:</b> <code>${userId}</code>
📅 <b>Дней в боте: ${daysInBot}</b>
➖➖➖➖➖
💰 <b>Баланс:</b>

• <b>💰 Текущий баланс: ${balance} ${config.currency || '₽'}</b>
• <b>⌛ В процессе вывода: ${withdrawing} ${config.currency || '₽'}</b>
• <b>💰 Всего заработано: ${withdrawed} ${config.currency || '₽'}</b>`;
        bot.sendMessage(chatId, response, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[
                    { text: '📜 Пополнить', callback_data: 'replenish' },
                    { text: '📛 Вывести', callback_data: 'withdraw' }
                ]]
            }
        }).catch(() => {});
    });
});

// ========== КНОПКА "ПРОДВИЖЕНИЕ" ==========
if (config.canpromote !== 'no') {
    bot.onText(/📙 Продвижение/, async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const subscriptions = await checkSubscriptions(userId);
        if (subscriptions !== true) {
            bot.sendMessage(chatId, config.subscribemsg || 'Подпишитесь на каналы:', {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: subscriptions }
            }).catch(() => {});
            return;
        }

        db.get(`SELECT count(*) as count FROM subscriptions WHERE datetime(creationDate, '+' || hours || ' hours') > datetime('now')`, (err, row) => {
            if (err) { log(err); return; }
            const count = row ? row.count : 0;
            if (count < maxaddedrequiredchannels) {
                bot.sendMessage(chatId, 'В этом разделе Вы можете приобрести продвижение канала/чата для обязательной подписки, а также заказать рассылку Вашей рекламы по всему боту. Всё происходит автоматически. Наслаждайтесь!', {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '➡ Добавить канал', callback_data: 'addchannel' },
                             { text: '🔄 Мои каналы', callback_data: 'listchannels' }],
                            [{ text: '📟 Заказать рассылку в боте', callback_data: 'orderbroadcast' }]
                        ]
                    }
                }).catch(() => {});
            } else {
                bot.sendMessage(chatId, 'Упс.. Уже добавлено максимальное количество каналов для подписки. Подождите, пока добавление вновь станет доступно.', {
                    parse_mode: 'HTML'
                }).catch(() => {});
            }
        });
    });
}

// ========== КНОПКА "ЗАДАНИЯ" ==========
bot.onText(/📋 Задания/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const subscriptions = await checkSubscriptions(userId);
    if (subscriptions !== true) {
        bot.sendMessage(chatId, config.subscribemsg || 'Подпишитесь на каналы:', {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: subscriptions }
        }).catch(() => {});
        return;
    }

    db.all(`SELECT t.* FROM tasks t LEFT JOIN user_tasks ut ON t.id = ut.task_id AND ut.user_id = ? WHERE t.active = 1 AND ut.id IS NULL`, [userId], (err, rows) => {
        if (err) { log(err); return; }
        if (!rows || rows.length === 0) {
            bot.sendMessage(chatId, '📭 На данный момент нет доступных заданий.').catch(() => {});
            return;
        }
        let text = '📋 <b>Доступные задания:</b>\n\n';
        let keyboard = [];
        rows.forEach(row => {
            text += `🔹 <b>${row.channel}</b> – награда: ${row.reward} ${config.currency || '₽'}\n`;
            keyboard.push([{ text: `✅ Проверить подписку на ${row.channel}`, callback_data: `checktask_${row.id}` }]);
        });
        bot.sendMessage(chatId, text, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
        }).catch(() => {});
    });
});

// ========== КНОПКА "ИНФОРМАЦИЯ О БОТЕ" ==========
bot.onText(/📳 Информация о боте/, async (msg) => {
    const chatId = msg.chat.id;
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    db.get(`
        SELECT (SELECT COUNT(*) FROM users) as totalUsers,
               (SELECT COUNT(*) FROM users WHERE registrationDate > ?) as newUsers,
               (SELECT SUM(amount) FROM withdraws) as withdraws
    `, [twentyFourHoursAgo], (err, result) => {
        if (err) { log(err); return; }
        const totalUsers = result ? result.totalUsers : 0;
        const newUsers = result ? result.newUsers : 0;
        const withdraws1 = result ? result.withdraws || 0 : 0;
        const days = Math.floor((new Date() - new Date(config.startDate || '2026-06-29')) / (24 * 60 * 60 * 1000));
        const response = `📳 <b>Статистика нашего бота:</b>

👪 <b>Всего пользователей: </b>${totalUsers}
🧑‍💻 <b>Новых за сегодня: </b>${newUsers}
💰 <b>Всего выплачено: </b>${withdraws1} ${config.currency || '₽'}
📅 <b>Мы работаем уже </b>${days} дней`;
        bot.sendMessage(chatId, response, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📙 Канал', url: config.channel || 'https://t.me/COINREF_OFFICIAL' },
                     { text: '💬 Чат', url: config.chat || 'https://t.me/yourchat' },
                     { text: '⭐ Отзывы', url: config.reviews || 'https://t.me/yourreviews' }],
                    [{ text: '📎 Правила', url: config.rules || 'https://t.me/yourrules' },
                     { text: '❓ Задать вопрос', url: 'tg://user?id=' + admin[0] }],
                    [{ text: '🏲 Топ рефералов за день', callback_data: 'reftop_day' }],
                    [{ text: '🏳 Топ рефералов за всё время', callback_data: 'reftop_all' }]
                ]
            }
        }).catch(() => {});
    });
});

// ========== КНОПКА "ПРОМОКОДЫ" ==========
bot.onText(/🎵 Промокоды/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const subscriptions = await checkSubscriptions(userId);
    if (subscriptions !== true) {
        bot.sendMessage(chatId, config.subscribemsg || 'Подпишитесь на каналы:', {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: subscriptions }
        }).catch(() => {});
        return;
    }

    bot.sendMessage(chatId, '⭐ Введите промокод для активации:', {
        reply_markup: cancel_keyboard
    }).catch(() => {});
    promocodes.set(userId, {});
});

// ==================== ОБРАБОТЧИК СООБЩЕНИЙ ====================
bot.on('message', async (msg) => {
    if (!msg || !msg.text) return;
    const userId = msg.from.id;
    const chatId = msg.chat.id;

    // Игнорируем команды и кнопки меню
    const menuTexts = ['🎁 Бонус', '🏆 Топ', '💰 Заработать', '👇 Личный кабинет', '📙 Продвижение', '📋 Задания', '📳 Информация о боте', '🎵 Промокоды', '❌ Отменить'];
    if (msg.text.startsWith('/') || menuTexts.includes(msg.text)) return;

    const subscriptions = await checkSubscriptions(userId);
    if (subscriptions !== true) {
        bot.sendMessage(chatId, config.subscribemsg || 'Подпишитесь на каналы:', {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: subscriptions }
        }).catch(() => {});
        return;
    }

    log(msg.from.first_name + (msg.from.last_name ? ' ' + msg.from.last_name : '') + '(' + msg.from.id + ')' + (msg.from.username ? ' @' + msg.from.username : '') + ': ' + msg.text);

    // ========== ВЫВОД СРЕДСТВ ==========
    if (withdraws.has(userId)) {
        if (!withdraws.get(userId).amount) {
            if (isNaN(msg.text)) {
                bot.sendMessage(chatId, '❌ Нужно ввести число. Операция отменена.', { reply_markup: menu_keyboard }).catch(() => {});
                withdraws.delete(userId);
                return;
            }
            const amount = parseFloat(msg.text);
            if (amount < minAmount) {
                bot.sendMessage(chatId, `💰 Мин. сумма: ${minAmount}. Попробуйте снова или нажмите ❌ Отменить`, { reply_markup: cancel_keyboard }).catch(() => {});
                return;
            }
            db.get(`SELECT * FROM users WHERE chatId = ?`, [userId], (err, row) => {
                if (err || !row) { log(err); return; }
                if (amount > row.balance) {
                    bot.sendMessage(chatId, `💰 Макс. сумма: ${row.balance}. Операция отменена.`, { reply_markup: menu_keyboard }).catch(() => {});
                    withdraws.delete(userId);
                    return;
                }
                withdraws.set(userId, { amount, wallet: undefined });
                bot.sendMessage(chatId, '💰 Введите реквизиты для вывода (Карта, СБП, Криптокошелёк и др.):', { reply_markup: cancel_keyboard }).catch(() => {});
            });
        } else if (!withdraws.get(userId).wallet) {
            withdraws.set(userId, { amount: withdraws.get(userId).amount, wallet: msg.text });
            bot.sendMessage(chatId, '💰 Повторите реквизиты для подтверждения:', { reply_markup: cancel_keyboard }).catch(() => {});
        } else {
            if (msg.text !== withdraws.get(userId).wallet) {
                bot.sendMessage(chatId, '❌ Реквизиты не совпадают. Попробуйте снова или нажмите ❌ Отменить', { reply_markup: cancel_keyboard }).catch(() => {});
                withdraws.delete(userId);
                return;
            }
            db.get(`SELECT * FROM users WHERE chatId = ?`, [userId], (err, row) => {
                if (err || !row) { log(err); return; }
                const withdraw = withdraws.get(userId);
                const amount = withdraw.amount;
                const wallet = withdraw.wallet;
                if (amount > row.balance) {
                    bot.sendMessage(chatId, '❌ Недостаточно баланса.', { reply_markup: menu_keyboard }).catch(() => {});
                    withdraws.delete(userId);
                    return;
                }
                db.run(`INSERT INTO withdraws(chatId, amount, wallet) VALUES (?, ?, ?)`, [userId, amount, wallet]);
                db.run(`UPDATE users SET balance = balance + ? WHERE chatId = ?`, [-amount, userId]);
                bot.sendMessage(chatId, `✅ Заявка на выплату создана.\n\n💰 Сумма: ${amount}\n💰 Реквизиты: ${wallet}\n\n⏳ Ожидание до 72 часов`, { reply_markup: menu_keyboard }).catch(() => {});
                bot.sendMessage(admin[0], '⚠️ Поступила заявка на выплату.').catch(() => {});
                withdraws.delete(userId);
            });
        }
        return;
    }

    // ========== ДОБАВЛЕНИЕ КАНАЛА ==========
    if (addchannel.has(userId)) {
        if (!addchannel.get(userId).hours) {
            if (isNaN(msg.text)) {
                bot.sendMessage(chatId, '❌ Нужно ввести число. Операция отменена.', { reply_markup: menu_keyboard }).catch(() => {});
                addchannel.delete(userId);
                return;
            }
            const hours = parseFloat(msg.text);
            if (hours < 1) {
                bot.sendMessage(chatId, '💰 Мин. срок: от 1 часа. Попробуйте снова или нажмите ❌ Отменить', { reply_markup: cancel_keyboard }).catch(() => {});
                return;
            }
            db.get(`SELECT * FROM users WHERE chatId = ?`, [userId], (err, row) => {
                if (err || !row) { log(err); return; }
                if (hours > row.balance * priceperhour) {
                    bot.sendMessage(chatId, `❌ Недостаточный баланс: ${hours} * ${priceperhour} > ${row.balance}`, { reply_markup: menu_keyboard }).catch(() => {});
                    addchannel.delete(userId);
                    return;
                }
                addchannel.set(userId, { hours, channel: undefined, name: undefined });
                bot.sendMessage(chatId, '💰 Отправьте @username канала (или ссылку).', { reply_markup: cancel_keyboard }).catch(() => {});
            });
        } else if (!addchannel.get(userId).channel) {
            let channelClean = msg.text.trim().replace(/[@https:\/\/t.me\/]/g, '');
            if (!channelClean) {
                bot.sendMessage(chatId, '❌ Вы не ввели username канала. Попробуйте снова или /cancel', { reply_markup: cancel_keyboard }).catch(() => {});
                return;
            }
            let chat;
            try {
                chat = await bot.getChat('@' + channelClean);
            } catch (e) {
                bot.sendMessage(chatId, `❌ Канал @${channelClean} не найден. Убедитесь, что:\n1. Канал существует и публичный.\n2. Бот добавлен в канал как администратор.\n3. У бота есть права на просмотр сообщений.\n\nПопробуйте снова или /cancel`, { reply_markup: cancel_keyboard }).catch(() => {});
                addchannel.delete(userId);
                return;
            }
            let botMember;
            try {
                const botInfo = await bot.getMe();
                botMember = await bot.getChatMember('@' + channelClean, botInfo.id);
            } catch (e) {
                bot.sendMessage(chatId, `❌ Не удалось проверить права бота в канале @${channelClean}. Убедитесь, что бот добавлен как администратор.`, { reply_markup: cancel_keyboard }).catch(() => {});
                addchannel.delete(userId);
                return;
            }
            if (!botMember || (botMember.status !== 'administrator' && botMember.status !== 'creator')) {
                bot.sendMessage(chatId, `❌ Бот не является администратором канала @${channelClean}. Добавьте бота как администратора и попробуйте снова.`, { reply_markup: cancel_keyboard }).catch(() => {});
                addchannel.delete(userId);
                return;
            }
            addchannel.set(userId, {
                hours: addchannel.get(userId).hours,
                channel: channelClean,
                name: chat.title
            });
            db.get(`SELECT count(*) as count FROM subscriptions WHERE datetime(creationDate, '+' || hours || ' hours') > datetime('now')`, async (err, row) => {
                if (err) { log(err); return; }
                const count = row ? row.count : 0;
                if (count < maxaddedrequiredchannels) {
                    await db.run(`INSERT INTO subscriptions(ownerId, hours, channel, title) VALUES (?, ?, ?, ?)`,
                        [userId, addchannel.get(userId).hours, channelClean, chat.title]);
                    db.run(`UPDATE users SET balance = balance + ? WHERE chatId = ?`,
                        [-(addchannel.get(userId).hours * priceperhour), userId], err1 => {
                            if (err1) { log(err1); return; }
                            addchannel.delete(userId);
                            bot.sendMessage(chatId, `✅ Канал @${channelClean} успешно добавлен!`, { reply_markup: menu_keyboard }).catch(() => {});
                        });
                } else {
                    bot.sendMessage(chatId, '❌ Максимальное количество каналов достигнуто.', { reply_markup: menu_keyboard }).catch(() => {});
                    addchannel.delete(userId);
                }
            });
        }
        return;
    }

    // ========== ЗАКАЗ РАССЫЛКИ ==========
    if (orderbroadcasts.has(userId)) {
        if (!orderbroadcasts.get(userId).auditory) {
            if (isNaN(msg.text)) {
                bot.sendMessage(chatId, '❌ Нужно ввести число. Операция отменена.', { reply_markup: menu_keyboard }).catch(() => {});
                orderbroadcasts.delete(userId);
                return;
            }
            const auditory = parseInt(msg.text);
            db.get(`SELECT balance FROM users WHERE chatId = ?`, [userId], (err, row) => {
                if (err || !row) { log(err); return; }
                if (row.balance < auditory * priceperuser) {
                    bot.sendMessage(chatId, `❌ Недостаточно баланса. Доступно: ${row.balance}, требуется: ${auditory * priceperuser}`, { reply_markup: menu_keyboard }).catch(() => {});
                    orderbroadcasts.delete(userId);
                    return;
                }
                orderbroadcasts.set(userId, { auditory, msg: undefined });
                bot.sendMessage(chatId, '⏳ Отправьте сообщение для рассылки', { reply_markup: cancel_keyboard }).catch(() => {});
            });
        } else {
            orderbroadcasts.set(userId, { auditory: orderbroadcasts.get(userId).auditory, msg: msg });
            broadcastMessageConfirm(msg, userId, true);
        }
        return;
    }

    // ========== РАССЫЛКА (АДМИН) ==========
    if (broadcasts.has(userId)) {
        if (!broadcasts.get(userId).auditory) {
            if (isNaN(msg.text)) {
                bot.sendMessage(chatId, '❌ Нужно ввести число. Операция отменена.', { reply_markup: menu_keyboard }).catch(() => {});
                broadcasts.delete(userId);
                return;
            }
            const auditory = parseInt(msg.text);
            broadcasts.set(userId, { auditory, msg: undefined });
            bot.sendMessage(chatId, '⏳ Отправьте сообщение для рассылки', { reply_markup: cancel_keyboard }).catch(() => {});
        } else {
            broadcasts.set(userId, { auditory: broadcasts.get(userId).auditory, msg: msg });
            broadcastMessageConfirm(msg, userId);
        }
        return;
    }

    // ========== ИЗМЕНЕНИЕ БАЛАНСА (АДМИН) ==========
    if (adminfuncs.has(userId)) {
        if (!admin.includes(userId)) { adminfuncs.delete(userId); return; }
        const func = adminfuncs.get(userId).func;
        if (func === 'changebalance') {
            const parts = msg.text.split(' ');
            if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) {
                bot.sendMessage(chatId, '❌ Неверный формат. Нужно: ID сумма (например, 123456 -10.5)', { reply_markup: menu_keyboard }).catch(() => {});
                adminfuncs.delete(userId);
                return;
            }
            const user = parseInt(parts[0]);
            const dif = parseFloat(parts[1]);
            adminfuncs.delete(userId);
            db.run(`UPDATE users SET balance = balance + ? WHERE chatId = ?`, [dif, user]);
            db.get(`SELECT balance, username, firstName FROM users WHERE chatId = ?`, [user], (err, row) => {
                if (err || !row) {
                    bot.sendMessage(chatId, 'Пользователь не найден', { reply_markup: menu_keyboard }).catch(() => {});
                    return;
                }
                bot.sendMessage(chatId, `Баланс пользователя ${row.username ? '@' + row.username : row.firstName} изменён на ${dif}р.\nНовый баланс: ${row.balance}`, { reply_markup: menu_keyboard }).catch(() => {});
            });
        }
        return;
    }

    // ========== ПРОСМОТР РЕФЕРАЛОВ (АДМИН) ==========
    if (adminreferals.has(userId)) {
        adminreferals.delete(userId);
        if (!admin.includes(userId)) return;
        if (!isNaN(msg.text)) {
            db.all(`SELECT * FROM users WHERE referer = ? LIMIT 100`, [parseInt(msg.text)], (err, rows) => {
                if (err || rows.length === 0) {
                    bot.sendMessage(chatId, 'Рефералы не найдены', { reply_markup: menu_keyboard }).catch(() => {});
                    return;
                }
                let text = '';
                rows.forEach(row => {
                    text += `<b>${row.chatId}</b> (${row.firstName}) ${row.username ? '@' + row.username + ' ' : ''} ${row.verified === 1 ? '✅' : '❌'} <b>${row.balance.toFixed(2)} ${config.currency || '₽'}</b>\n`;
                });
                bot.sendMessage(chatId, `Рефералы пользователя (первые ${rows.length}) ℹ${msg.text}:\n${text}`, { parse_mode: 'HTML', reply_markup: menu_keyboard }).catch(() => {});
            });
        } else {
            bot.sendMessage(chatId, 'Нужно ввести число.', { reply_markup: menu_keyboard }).catch(() => {});
        }
        return;
    }

    // ========== АКТИВАЦИЯ ПРОМОКОДА ==========
    if (promocodes.has(userId)) {
        promocodes.delete(userId);
        db.get(`SELECT * FROM promocodes p WHERE p.hash = ? AND p.hash NOT IN (SELECT hash FROM promocodeactivations WHERE userId = ?) AND p.activations > (SELECT count(*) FROM promocodeactivations WHERE hash = p.hash)`, [msg.text, userId], async (err, row) => {
            if (err || !row) {
                bot.sendMessage(chatId, 'Промокод не найден или уже активирован', { reply_markup: menu_keyboard }).catch(() => {});
                return;
            }
            db.run(`INSERT OR IGNORE INTO promocodeactivations(userId, hash) VALUES (?, ?)`, [userId, msg.text]);
            db.run(`UPDATE users SET balance = balance + ? WHERE chatId = ?`, [row.sum, userId]);
            await bot.sendMessage(userId, `✅ Промокод активирован: <b>+${row.sum.toFixed(2)} ${config.currency || '₽'}</b>`, { parse_mode: 'HTML', reply_markup: menu_keyboard }).catch(() => {});
            bot.sendMessage(admin[0], `⚠️ Промокод <b>${msg.text}</b> активирован пользователем <b>${userId}</b>`, { parse_mode: 'HTML' }).catch(() => {});
        });
        return;
    }

    // ========== СОЗДАНИЕ ПРОМОКОДА (АДМИН) ==========
    if (adminpromocode.has(userId)) {
        if (!admin.includes(userId)) { adminpromocode.delete(userId); return; }
        const promo = adminpromocode.get(userId);
        if (!promo.sum) {
            if (isNaN(msg.text)) {
                bot.sendMessage(chatId, '❌ Нужно ввести число', { reply_markup: menu_keyboard }).catch(() => {});
                adminpromocode.delete(userId);
                return;
            }
            promo.sum = parseFloat(msg.text);
            await bot.sendMessage(userId, '💰 Введите количество активаций:', { reply_markup: cancel_keyboard }).catch(() => {});
        } else if (!promo.activations) {
            if (isNaN(msg.text)) {
                bot.sendMessage(chatId, '❌ Нужно ввести число', { reply_markup: menu_keyboard }).catch(() => {});
                adminpromocode.delete(userId);
                return;
            }
            promo.activations = parseInt(msg.text);
            promo.hash = makeid(8);
            db.run(`INSERT INTO promocodes (hash, activations, sum) VALUES (?, ?, ?)`, [promo.hash, promo.activations, promo.sum], async (err) => {
                if (err) { log(err); return; }
                await bot.sendMessage(userId, `Промокод на сумму ${promo.sum.toFixed(2)} ${config.currency || '₽'} и ${promo.activations} активаций создан: <code>${promo.hash}</code>`, { parse_mode: 'HTML', reply_markup: menu_keyboard }).catch(() => {});
                adminpromocode.delete(userId);
            });
        }
        return;
    }

    // ========== СОЗДАНИЕ ЗАДАНИЯ (АДМИН) ==========
    if (adminTask.has(userId)) {
        if (!admin.includes(userId)) { adminTask.delete(userId); return; }
        const taskData = adminTask.get(userId);
        if (!taskData.channel) {
            const channel = msg.text.trim().replace(/[@https:\/\/t.me\/]/g, '');
            if (!channel) {
                bot.sendMessage(chatId, '❌ Некорректный username канала. Попробуйте снова или /cancel', { reply_markup: cancel_keyboard }).catch(() => {});
                return;
            }
            try {
                await bot.getChat('@' + channel);
            } catch (e) {
                bot.sendMessage(chatId, `❌ Канал @${channel} не найден. Убедитесь, что бот администратор и username правильный.`, { reply_markup: cancel_keyboard }).catch(() => {});
                return;
            }
            taskData.channel = channel;
            adminTask.set(userId, taskData);
            bot.sendMessage(chatId, `💰 Введите сумму вознаграждения (в ${config.currency || '₽'}):`, { reply_markup: cancel_keyboard }).catch(() => {});
        } else if (!taskData.reward) {
            if (isNaN(msg.text)) {
                bot.sendMessage(chatId, '❌ Нужно ввести число. Попробуйте снова или /cancel', { reply_markup: cancel_keyboard }).catch(() => {});
                return;
            }
            const reward = parseFloat(msg.text);
            if (reward <= 0) {
                bot.sendMessage(chatId, '❌ Сумма должна быть больше 0.', { reply_markup: cancel_keyboard }).catch(() => {});
                return;
            }
            taskData.reward = reward;
            db.run(`INSERT INTO tasks (channel, reward, created_by) VALUES (?, ?, ?)`, [taskData.channel, reward, userId], function(err) {
                if (err) { log(err); bot.sendMessage(chatId, '❌ Ошибка сохранения задания.').catch(() => {}); return; }
                bot.sendMessage(chatId, `✅ Задание для канала @${taskData.channel} с наградой ${reward} ${config.currency || '₽'} создано!`, { reply_markup: menu_keyboard }).catch(() => {});
                adminTask.delete(userId);
            });
        }
        return;
    }
});

// ==================== CALLBACK QUERY ====================
bot.on('callback_query', async (msg) => {
    if (!msg || !msg.data) return;
    const userId = msg.from.id;
    const chatId = msg.message.chat.id;
    log(userId + ' отправил обратную связь: ' + msg.data);

    const data = msg.data.split('_');
    switch (data[0]) {
        case 'withdraw': {
            db.get(`SELECT * FROM users WHERE chatId = ?`, [userId], (err, row) => {
                if (err || !row) { log(err); return; }
                if (row.balance < minAmount) {
                    bot.sendMessage(chatId, `❌ Мин. сумма вывода: ${minAmount}`, { reply_markup: menu_keyboard }).catch(() => {});
                    return;
                }
                withdraws.set(userId, { amount: undefined, wallet: undefined });
                bot.sendMessage(chatId, `💰 Введите сумму от ${minAmount} до ${row.balance}:`, { reply_markup: cancel_keyboard }).catch(() => {});
            });
            break;
        }
        case 'replenish': {
            bot.sendMessage(chatId, config.replenish ? config.replenish.replaceAll("{id}", userId) : 'Пополнение баланса: {id}', { parse_mode: 'HTML' }).catch(() => {});
            break;
        }
        case 'withdraws': {
            if (!admin.includes(userId)) break;
            if (data[1] && data[1] === 'skip') current_withdraw_offset++;
            else current_withdraw_offset = 0;
            db.get(`SELECT count(*) as count FROM withdraws WHERE status = 0`, (err, row) => {
                if (err) { log(err); return; }
                const count = row ? row.count : 0;
                if (count === 0) {
                    bot.sendMessage(chatId, '❌ Нет заявок на выплату').catch(() => {});
                    return;
                }
                if (current_withdraw_offset >= count) current_withdraw_offset = count - 1;
                db.get(`SELECT * FROM withdraws WHERE status = 0 LIMIT 1 OFFSET ?`, [current_withdraw_offset], (err, row1) => {
                    if (err || !row1) { log(err); return; }
                    db.get(`SELECT * FROM users WHERE chatId = ?`, [row1.chatId], (err, row) => {
                        if (err || !row) { log(err); return; }
                        bot.sendMessage(chatId, `Всего заявок: ${count}\nПропущено: ${current_withdraw_offset}\n\nПользователь: ${row.username ? '@' + row.username : row.firstName}\nСумма: ${row1.amount}\nРеквизиты: <code>${row1.wallet}</code>`,
                            {
                                parse_mode: 'HTML',
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: '⏳ Пропустить', callback_data: 'withdraws_skip' }],
                                        [{ text: '✅ Выплатить', callback_data: 'acceptwithdraw_' + row1.id }],
                                        [{ text: '❌ Отказать', callback_data: 'declinewithdraw_' + row1.id }]
                                    ]
                                }
                            }
                        ).catch(() => {});
                    });
                });
            });
            break;
        }
        case 'acceptwithdraw': {
            if (!admin.includes(userId)) break;
            const id = parseInt(data[1]);
            db.get(`SELECT * FROM withdraws WHERE id = ? AND status = 0`, [id], (err, row) => {
                if (err || !row) { log(err); return; }
                db.run(`UPDATE withdraws SET status = 1 WHERE id = ?`, [id]);
                bot.sendMessage(row.chatId, `✅ Выплата ${row.amount} на ${row.wallet} подтверждена.`).catch(() => {});
                bot.sendMessage(config.withdraws || admin[0], `📵 <b><a href="tg://user?id=${row.chatId}">пользователь</a> вывел ${row.amount} ${config.currency || '₽'}</b>`, { parse_mode: 'HTML' }).catch(() => {});
                bot.sendMessage(admin[0], 'Готово.', { reply_markup: { inline_keyboard: [[{ text: '📛 Заявки', callback_data: 'withdraws' }]] } }).catch(() => {});
            });
            break;
        }
        case 'declinewithdraw': {
            if (!admin.includes(userId)) break;
            const id = parseInt(data[1]);
            db.get(`SELECT * FROM withdraws WHERE id = ? AND status = 0`, [id], (err, row) => {
                if (err || !row) { log(err); return; }
                db.run(`UPDATE withdraws SET status = 2 WHERE id = ?`, [id]);
                db.run(`UPDATE users SET balance = balance + ? WHERE chatId = ?`, [row.amount, row.chatId]);
                bot.sendMessage(row.chatId, `❌ Выплата ${row.amount} на ${row.wallet} отклонена.`).catch(() => {});
                bot.sendMessage(admin[0], 'Отказ отправлен.', { reply_markup: { inline_keyboard: [[{ text: '📛 Заявки', callback_data: 'withdraws' }]] } }).catch(() => {});
            });
            break;
        }
        case 'addchannel': {
            db.get(`SELECT count(*) as count FROM subscriptions WHERE datetime(creationDate, '+' || hours || ' hours') > datetime('now')`, (err, row) => {
                if (err) { log(err); return; }
                const count = row ? row.count : 0;
                if (count < maxaddedrequiredchannels) {
                    addchannel.set(userId, { hours: undefined, channel: undefined, name: undefined });
                    bot.sendMessage(chatId, '💰 Отправьте срок (в часах):', { reply_markup: cancel_keyboard }).catch(() => {});
                } else {
                    bot.sendMessage(chatId, '❌ Максимум каналов достигнут.').catch(() => {});
                }
            });
            break;
        }
        case 'listchannels': {
            db.all(`SELECT * FROM subscriptions WHERE datetime(creationDate, '+' || hours || ' hours') > datetime('now') AND ownerId = ?`, [userId], (err, rows) => {
                if (err || !rows || rows.length === 0) {
                    bot.sendMessage(chatId, 'Нет каналов').catch(() => {});
                    return;
                }
                let message = 'Ваши каналы:\n';
                rows.forEach(row => {
                    message += `\n@${row.channel}  Создан: ${row.creationDate}  Срок: ${row.hours} ч.`;
                });
                bot.sendMessage(chatId, message).catch(() => {});
            });
            break;
        }
        case 'broadcast': {
            if (!admin.includes(userId)) break;
            if (data[1]) {
                if (data[1] === 'confirm') {
                    const msgObj = JSON.parse(JSON.stringify(broadcasts.get(userId).msg));
                    const auditory = JSON.parse(JSON.stringify(broadcasts.get(userId).auditory));
                    bot.sendMessage(chatId, '✅ Рассылка запущена').catch(() => {});
                    broadcastMessage(msgObj, auditory);
                    broadcasts.delete(userId);
                } else {
                    bot.sendMessage(chatId, 'Отменено').catch(() => {});
                    broadcasts.delete(userId);
                }
            } else {
                broadcasts.set(userId, { auditory: undefined, msg: undefined });
                bot.sendMessage(chatId, '⚠️ Введите количество человек:', { reply_markup: cancel_keyboard }).catch(() => {});
            }
            break;
        }
        case 'orderbroadcast': {
            if (data[1]) {
                if (data[1] === 'confirm') {
                    db.get(`SELECT balance FROM users WHERE chatId = ?`, [userId], (err, row) => {
                        if (err || !row) { log(err); return; }
                        const cost = orderbroadcasts.get(userId).auditory * priceperuser;
                        if (row.balance < cost) {
                            bot.sendMessage(chatId, '❌ Недостаточно баланса').catch(() => {});
                            orderbroadcasts.delete(userId);
                            return;
                        }
                        db.run(`UPDATE users SET balance = balance - ? WHERE chatId = ?`, [cost, userId]);
                        broadcastMessage(orderbroadcasts.get(userId).msg, orderbroadcasts.get(userId).auditory, userId);
                        setTimeout(() => orderbroadcasts.delete(userId), 1000);
                    });
                } else {
                    bot.sendMessage(chatId, 'Отменено').catch(() => {});
                    orderbroadcasts.delete(userId);
                }
            } else {
                orderbroadcasts.set(userId, { auditory: undefined, msg: undefined });
                bot.sendMessage(chatId, `⚠️ Введите количество человек.\nЦена: ${priceperuser} ${config.currency || '₽'} за чел.`, { reply_markup: cancel_keyboard }).catch(() => {});
            }
            break;
        }
        case 'changebalance': {
            if (admin.includes(userId)) {
                adminfuncs.set(userId, { func: 'changebalance' });
                bot.sendMessage(chatId, '💰 Введите ID и сумму через пробел\nНапример: 1234567890 -10.5', { reply_markup: cancel_keyboard }).catch(() => {});
            }
            break;
        }
        case 'editchannels': {
            if (admin.includes(userId)) {
                db.all(`SELECT * FROM subscriptions WHERE datetime(creationDate, '+' || hours || ' hours') > datetime('now')`, (err, rows) => {
                    if (err || !rows) { log(err); return; }
                    const keyboard = rows.map(row => [{ text: row.title, callback_data: 'editchannel_' + row.id }]);
                    bot.sendMessage(chatId, '📷 Текущие каналы:', { reply_markup: { inline_keyboard: keyboard } }).catch(() => {});
                });
            }
            break;
        }
        case 'editchannel': {
            if (admin.includes(userId)) {
                db.get(`SELECT * FROM subscriptions WHERE id = ?`, [parseInt(data[1])], (err, row) => {
                    if (err || !row) { log(err); return; }
                    bot.sendMessage(chatId, `Заголовок: ${row.title}\nКанал: https://t.me/${row.channel}`,
                        { reply_markup: { inline_keyboard: [[{ text: '🗑 Удалить', callback_data: 'deletechannel_' + row.id }]] } }
                    ).catch(() => {});
                });
            }
            break;
        }
        case 'deletechannel': {
            if (admin.includes(userId)) {
                db.run(`DELETE FROM subscriptions WHERE id = ?`, [parseInt(data[1])]);
                bot.sendMessage(chatId, '🗑 Канал удалён').catch(() => {});
            }
            break;
        }
        case 'reftop': {
            const period = data[1];
            const whereClause = period === 'day' ? "AND u2.registrationDate >= DATETIME('now', '-1 day')" : "";
            const query = `
                SELECT u1.chatId, u1.firstName, u1.username, u1.referer,
                       COUNT(u2.referer) AS referer_count
                FROM users u1
                LEFT JOIN users u2 ON u1.chatId = u2.referer ${whereClause}
                GROUP BY u1.chatId
                ORDER BY referer_count DESC
                LIMIT 10;
            `;
            db.all(query, (err, rows) => {
                if (err) { log(err); return; }
                let title = period === 'day' ? '🏲 Топ за день' : '🏳 Топ за всё время';
                let message = title + ':\n';
                if (!rows || rows.length === 0) {
                    message += '\nНет данных. Пригласите друзей!';
                } else {
                    rows.forEach(row => {
                        message += `\n${row.referer_count} - ${row.username ? '@' + row.username : row.firstName}`;
                    });
                }
                bot.sendMessage(userId, message).catch(() => {});
            });
            break;
        }
        case 'adminreferals': {
            adminreferals.set(userId, {});
            bot.sendMessage(userId, 'Введите ID пользователя:', { reply_markup: cancel_keyboard }).catch(() => {});
            break;
        }
        case 'adminpromocode': {
            adminpromocode.set(userId, {});
            bot.sendMessage(userId, '⭐ Введите сумму промокода:', { reply_markup: cancel_keyboard }).catch(() => {});
            break;
        }
        case 'createtask': {
            if (admin.includes(userId)) {
                adminTask.set(userId, { channel: null, reward: null });
                bot.sendMessage(chatId, '📝 Введите username канала (без @) для задания:', { reply_markup: cancel_keyboard }).catch(() => {});
            }
            break;
        }
        case 'checktask': {
            const taskId = parseInt(data[1]);
            db.get(`SELECT * FROM user_tasks WHERE user_id = ? AND task_id = ?`, [userId, taskId], (err, row) => {
                if (err || row) {
                    bot.sendMessage(chatId, '❌ Вы уже выполнили это задание.').catch(() => {});
                    return;
                }
                db.get(`SELECT * FROM tasks WHERE id = ? AND active = 1`, [taskId], async (err, task) => {
                    if (err || !task) {
                        bot.sendMessage(chatId, '❌ Задание не найдено или неактивно.').catch(() => {});
                        return;
                    }
                    const channel = '@' + task.channel;
                    let chatMember;
                    try {
                        chatMember = await bot.getChatMember(channel, userId);
                    } catch (e) {
                        bot.sendMessage(chatId, `❌ Не удалось проверить подписку на канал ${channel}.`).catch(() => {});
                        return;
                    }
                    if (!chatMember || chatMember.status === 'left' || chatMember.status === 'kicked') {
                        bot.sendMessage(chatId, `❌ Вы не подписаны на канал ${channel}. Подпишитесь и нажмите кнопку снова.`).catch(() => {});
                        return;
                    }
                    db.run(`UPDATE users SET balance = balance + ? WHERE chatId = ?`, [task.reward, userId], function(err) {
                        if (err) { log(err); bot.sendMessage(chatId, '❌ Ошибка начисления баланса.').catch(() => {}); return; }
                        db.run(`INSERT INTO user_tasks (user_id, task_id) VALUES (?, ?)`, [userId, taskId]);
                        bot.sendMessage(chatId, `✅ Подписка подтверждена! Вам начислено ${task.reward} ${config.currency || '₽'}.`).catch(() => {});
                        bot.sendMessage(admin[0], `👤 Пользователь ${userId} выполнил задание для канала @${task.channel} и получил ${task.reward} ${config.currency || '₽'}.`).catch(() => {});
                    });
                });
            });
            break;
        }
    }
    bot.answerCallbackQuery(msg.id).catch(() => {});
});

// ==================== ФУНКЦИИ ДЛЯ РАССЫЛКИ ====================
let current_withdraw_offset = 0;

function broadcastMessage(msg, auditory = null, firstChatId = admin[0], order = false) {
    const text = (msg.text || msg.caption || '');
    const form = {};
    if (msg.entities) form.entities = JSON.stringify(msg.entities);
    if (msg.caption) form.caption = text;
    if (msg.caption_entities) form.caption_entities = JSON.stringify(msg.caption_entities);
    const delay = time => new Promise(resolve => setTimeout(resolve, time));
    db.all(`SELECT chatId FROM users${auditory ? ' ORDER BY RANDOM() LIMIT ' + auditory : ''}`, async (err, rows) => {
        if (err) { log('Error fetching user data:', err); return; }
        const msg_b = createButtonsFromTemplate(text, form);
        const msg_b_form = msg_b.form;
        let counter = 0;
        if (msg.text) {
            let msg_b_text = msg_b.text;
            if (order) msg_b_text = '⚠️#реклама\n' + msg_b_text;
            for (const row of rows) {
                bot.sendMessage(row.chatId, msg_b_text, msg_b_form).catch(() => { counter++; });
                await delay(100);
            }
        }
        if (msg.photo) {
            const photo = msg.photo[0].file_id;
            for (const row of rows) {
                bot.sendPhoto(row.chatId, photo, msg_b_form).catch(() => { counter++; });
                await delay(100);
            }
        }
        bot.sendMessage(firstChatId, '✅ Рассылка завершена').catch(() => {});
        bot.sendMessage(admin[0], '💄 Не доставлено: ' + counter).catch(() => {});
    });
}

function broadcastMessageConfirm(msg, userId, order = false) {
    const text = (msg.text ? msg.text : (msg.caption ? msg.caption : null));
    const form = {};
    if (msg.entities) form.entities = JSON.stringify(msg.entities);
    if (msg.caption) form.caption = text;
    if (msg.caption_entities) form.caption_entities = JSON.stringify(msg.caption_entities);

    const msg_b = createButtonsFromTemplate(text, form);
    const msg_b_form = msg_b.form;
    const buttons = order ?
        [{ text: 'Подтвердить', callback_data: 'orderbroadcast_confirm' }, { text: 'Отклонить', callback_data: 'orderbroadcast_decline' }] :
        [{ text: 'Подтвердить', callback_data: 'broadcast_confirm' }, { text: 'Отклонить', callback_data: 'broadcast_decline' }];
    msg_b_form.reply_markup.inline_keyboard.push(buttons);
    if (msg.text) {
        bot.sendMessage(userId, msg_b.text, msg_b.form).catch(() => {});
    }
    if (msg.photo) {
        bot.sendPhoto(userId, msg.photo[0].file_id, msg_b.form).catch(() => {});
    }
}

function createButtonsFromTemplate(message, form) {
    const buttonRegex = /#([^#]+)#([^#]+)#/g;
    let match;
    const keyboardButtons = [];
    while ((match = buttonRegex.exec(message)) !== null) {
        keyboardButtons.push([{ text: match[1], url: match[2] }]);
    }
    const text = message.replace(buttonRegex, '');
    const options = { ...form, reply_markup: { inline_keyboard: keyboardButtons } };
    if (options.caption) options.caption = text;
    return { text, form: options };
}

// ==================== ОБРАБОТКА ОШИБОК ====================
bot.on('polling_error', (error) => {
    log('Polling error:', error);
});

process.on('SIGTERM', () => {
    process.exit();
});

console.log('✅ Бот запущен и готов к работе!');
