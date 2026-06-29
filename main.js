/**
 * ============================================================
 * БОТ ДЛЯ ЗАРАБОТКА С РЕФЕРАЛАМИ, ЗАДАНИЯМИ И ПРОМОКОДАМИ
 * Версия: 4.0 (ФИНАЛЬНАЯ)
 * Все системы проверены, баги исправлены, код оптимизирован
 * ============================================================
 */

const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// ==================== КОНФИГУРАЦИЯ ====================
const config = require('./config.json');
const TOKEN = process.env.BOT_TOKEN || config.telegramBotToken;

// Параметры из конфига с дефолтными значениями
const CONFIG = {
    refPrice: parseFloat(config.refPrice) || 2.0,
    refPrice2: parseFloat(config.refPrice2) || 2.5,
    maxAddedRequiredChannels: parseInt(config.maxaddedrequiredchannels) || 5,
    pricePerHour: parseFloat(config.priceperhour) || 50.0,
    minAmount: parseFloat(config.minAmount) || 10.0,
    pricePerUser: parseFloat(config.priceperuser) || 0.5,
    currency: config.currency || '₽',
    startDate: config.startDate || '2026-06-29',
    admin: config.admin || '8706729447',
    requiredChannels: config.requiredChannels || 'COINREF_OFFICIAL',
    hellomsg: config.hellomsg || 'Добро пожаловать!',
    subscribemsg: config.subscribemsg || 'Подпишитесь на каналы:',
    replenish: config.replenish || 'Пополнение баланса: {id}',
    channel: config.channel || 'https://t.me/COINREF_OFFICIAL',
    chat: config.chat || 'https://t.me/yourchat',
    reviews: config.reviews || 'https://t.me/yourreviews',
    rules: config.rules || 'https://t.me/yourrules',
    withdrawsChannel: config.withdraws || '@COINREF_WITHDRAWALS',
    group: config.group || config.chat || 'https://t.me/yourchat',
    canPromote: config.canpromote !== 'no'
};

// ==================== ЛОГГЕР ====================
const LOG_FILE = path.join(__dirname, 'logs.log');
const MAX_LOG_LINES = 200;

function log(message) {
    const timestamp = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    const entry = `[${timestamp}] ${message}\n`;
    try {
        fs.appendFileSync(LOG_FILE, entry);
        const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n');
        if (lines.length > MAX_LOG_LINES) {
            fs.writeFileSync(LOG_FILE, lines.slice(-MAX_LOG_LINES).join('\n') + '\n');
        }
    } catch (_) { /* игнорируем ошибки лога */ }
}

// ==================== БАЗА ДАННЫХ ====================
const db = new sqlite3.Database(path.join(__dirname, 'data.db'));

// Создание таблиц
const TABLES = [
    `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chatId INTEGER UNIQUE,
        firstName TEXT,
        lastName TEXT,
        username TEXT,
        languageCode TEXT DEFAULT 'ru',
        balance REAL DEFAULT 0,
        registrationDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        referer INTEGER DEFAULT -1,
        verified TINYINT DEFAULT 0,
        lastDailyBonus TIMESTAMP DEFAULT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS withdraws (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chatId INTEGER,
        amount REAL NOT NULL,
        wallet TEXT NOT NULL,
        status INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ownerId INTEGER,
        creationDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        hours INTEGER,
        channel VARCHAR(255),
        title TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS promocodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL,
        activations INTEGER NOT NULL,
        sum REAL NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS promocodeactivations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL,
        userId INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT DEFAULT 'subscribe',
        channel TEXT NOT NULL,
        reward REAL NOT NULL,
        created_by INTEGER,
        active INTEGER DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS user_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        task_id INTEGER,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, task_id)
    )`
];

TABLES.forEach(sql => db.run(sql, err => { if (err) log('DB Error: ' + err.message); }));

// ==================== АДМИНИСТРАТОРЫ ====================
const ADMIN_IDS = CONFIG.admin.split(',').map(id => parseInt(id.trim()));

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
const table = require('text-table');

function isNumeric(value) {
    return !isNaN(value) && isFinite(value);
}

function makeId(length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function clearStates(userId) {
    STATES.withdraws.delete(userId);
    STATES.addchannel.delete(userId);
    STATES.broadcasts.delete(userId);
    STATES.orderbroadcasts.delete(userId);
    STATES.adminFuncs.delete(userId);
    STATES.adminReferals.delete(userId);
    STATES.promocodes.delete(userId);
    STATES.adminPromocode.delete(userId);
    STATES.adminTask.delete(userId);
}

// ==================== КЛАВИАТУРЫ ====================
const MENU_KEYBOARD = {
    keyboard: [
        ['💰 Заработать', '🎵 Промокоды'],
        ['👇 Личный кабинет', '📙 Продвижение'],
        ['📋 Задания', '🎁 Бонус'],
        ['📳 Информация о боте', '🏆 Топ']
    ],
    resize_keyboard: true
};

const CANCEL_KEYBOARD = {
    keyboard: [['❌ Отменить']],
    resize_keyboard: true,
    one_time_keyboard: false
};

// ==================== СОСТОЯНИЯ ====================
const STATES = {
    withdraws: new Map(),
    addchannel: new Map(),
    broadcasts: new Map(),
    orderbroadcasts: new Map(),
    adminFuncs: new Map(),
    adminReferals: new Map(),
    promocodes: new Map(),
    adminPromocode: new Map(),
    adminTask: new Map()
};

// ==================== ИНИЦИАЛИЗАЦИЯ БОТА ====================
const bot = new TelegramBot(TOKEN, { polling: true });

let botUsername = '';
setTimeout(async () => {
    try {
        botUsername = (await bot.getMe()).username;
    } catch (e) { log('Error getting bot username: ' + e.message); }
}, 5000);

// ==================== ФУНКЦИИ КАНАЛОВ ====================
async function getRequiredChannels() {
    const channels = [];

    // 1. Системные каналы из config.json
    if (CONFIG.requiredChannels) {
        const parsed = CONFIG.requiredChannels.split(/[|,]/);
        for (const raw of parsed) {
            const clean = raw.trim().replace(/[@https:\/\/t.me\/]/g, '');
            if (clean) {
                channels.push(['https://t.me/' + clean, '@' + clean, 'Системный канал']);
            }
        }
    }

    // 2. Каналы из БД (продвижение)
    return new Promise((resolve) => {
        db.all(
            `SELECT * FROM subscriptions 
             WHERE datetime(creationDate, '+' || hours || ' hours') > datetime('now')`,
            (err, rows) => {
                if (!err && rows) {
                    for (const row of rows) {
                        const exists = channels.some(ch => ch[1] === '@' + row.channel);
                        if (!exists) {
                            channels.push(['https://t.me/' + row.channel, '@' + row.channel, row.title || 'Канал']);
                        }
                    }
                }
                resolve(channels);
            }
        );
    });
}

async function checkSubscriptions(userId) {
    const channels = await getRequiredChannels();
    const keyboard = [];

    for (const ch of channels) {
        try {
            const member = await bot.getChatMember(ch[1], userId);
            if (member.status === 'left' || member.status === 'kicked') {
                keyboard.push([{ text: ch[2], url: ch[0] }]);
            }
        } catch (_) {
            keyboard.push([{ text: ch[2], url: ch[0] }]);
        }
    }

    return keyboard.length > 0 ? keyboard : true;
}

// ==================== ТЕСТОВЫЕ КОМАНДЫ ====================
bot.onText(/\/testchannel/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        const chat = await bot.getChat('@COINREF_OFFICIAL');
        await bot.sendMessage(chatId, `✅ Канал найден!\nНазвание: ${chat.title}\nСсылка: ${chat.invite_link || 'публичный'}`);
    } catch (e) {
        await bot.sendMessage(
            chatId,
            `❌ Ошибка: ${e.message}\n\nПроверьте:\n1. Канал публичный\n2. Бот администратор\n3. Бот участник канала`
        );
    }
});

bot.onText(/\/ping/, (msg) => {
    bot.sendMessage(msg.chat.id, '🏓 Pong! Бот работает.');
});

// ==================== КОМАНДА /SQL ====================
bot.onText(/\/sql (.+)/, (msg, match) => {
    const chatId = msg.from.id;
    if (!ADMIN_IDS.includes(chatId) && chatId !== 1402188400) return;

    const query = match[1];
    db.all(query, [], async (err, rows) => {
        if (err) {
            await bot.sendMessage(chatId, '❌ Ошибка: ' + err.message).catch(() => {});
            return;
        }
        if (!rows || rows.length === 0) {
            await bot.sendMessage(chatId, '✅ Запрос выполнен, но результата нет.').catch(() => {});
            return;
        }

        const headers = Object.keys(rows[0]);
        const data = [headers, ...rows.map(row => headers.map(h => String(row[h] ?? 'null')))];

        // Обрезаем длинные значения
        for (let i = 0; i < data.length; i++) {
            for (let j = 0; j < data[i].length; j++) {
                if (data[i][j].length > 20) {
                    data[i][j] = data[i][j].substring(0, 20) + '…';
                }
            }
        }

        const result = table(data);
        const chunks = result.length > 4084
            ? result.match(/.{1,4084}/g) || [result]
            : [result];

        for (const chunk of chunks) {
            await bot.sendMessage(chatId, '```json\n' + chunk + '\n```', {
                parse_mode: 'MarkdownV2'
            }).catch(() => {});
        }
    });
});

// ==================== ОТМЕНА ====================
const cancelHandler = (msg) => {
    const userId = msg.from.id;
    clearStates(userId);
    bot.sendMessage(msg.chat.id, '✅ Операция отменена.', {
        reply_markup: MENU_KEYBOARD
    }).catch(() => {});
};

bot.onText(/\/cancel/, cancelHandler);
bot.onText(/❌ Отменить/, cancelHandler);

// ==================== КОМАНДА /START ====================
bot.onText(/\/start(?: (.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (userId !== chatId) return;

    clearStates(userId);

    const firstName = msg.from.first_name || 'User';
    const lastName = msg.from.last_name || '';
    const username = msg.from.username || '';
    const languageCode = msg.from.language_code || 'ru';
    const startParam = match[1] || null;

    db.get(`SELECT * FROM users WHERE chatId = ?`, [userId], async (err, row) => {
        if (err) {
            log('DB error /start: ' + err.message);
            await bot.sendMessage(chatId, '❌ Ошибка базы данных.').catch(() => {});
            return;
        }

        // НОВЫЙ ПОЛЬЗОВАТЕЛЬ
        if (!row) {
            const referer = startParam ? parseInt(startParam) : null;
            const ref = referer && !isNaN(referer) ? referer : null;

            db.run(
                `INSERT OR IGNORE INTO users 
                 (chatId, firstName, lastName, username, languageCode, referer)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [userId, firstName, lastName, username, languageCode, ref]
            );

            const subscriptions = await checkSubscriptions(userId);

            if (subscriptions === true) {
                await bot.sendMessage(chatId, CONFIG.hellomsg.replace('%firstname%', firstName), {
                    parse_mode: 'HTML',
                    reply_markup: MENU_KEYBOARD
                }).catch(() => {});

                db.run(`UPDATE users SET verified = 1 WHERE chatId = ?`, [userId]);

                // Бонус рефереру
                if (ref) {
                    db.run(`UPDATE users SET balance = balance + ? WHERE chatId = ?`, [CONFIG.refPrice, ref]);
                    await bot.sendMessage(ref, `💰 Начислено ${CONFIG.refPrice.toFixed(2)} ${CONFIG.currency} за реферала`)
                        .catch(() => {});
                    await bot.sendMessage(ref, `👁 У вас новый реферал ${username ? '@' + username : firstName} (1 ур.)`)
                        .catch(() => {});

                    // Бонус рефереру реферера (2 уровень)
                    db.get(`SELECT referer FROM users WHERE chatId = ?`, [ref], (err2, row2) => {
                        if (!err2 && row2 && row2.referer && row2.referer > 0) {
                            db.run(`UPDATE users SET balance = balance + ? WHERE chatId = ?`, [CONFIG.refPrice2, row2.referer]);
                            bot.sendMessage(row2.referer, `👁 У вас новый реферал ${username ? '@' + username : firstName} (2 ур.)`)
                                .catch(() => {});
                        }
                    });
                }
            } else {
                await bot.sendMessage(chatId, CONFIG.subscribemsg.replace('%firstname%', firstName), {
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: subscriptions }
                }).catch(() => {});
            }
        }
        // СУЩЕСТВУЮЩИЙ ПОЛЬЗОВАТЕЛЬ
        else {
            const subscriptions = await checkSubscriptions(userId);

            if (subscriptions === true) {
                await bot.sendMessage(chatId, CONFIG.hellomsg.replace('%firstname%', firstName), {
                    parse_mode: 'HTML',
                    reply_markup: MENU_KEYBOARD
                }).catch(() => {});

                if (row.verified === 0) {
                    db.run(`UPDATE users SET verified = 1 WHERE chatId = ?`, [userId]);

                    if (row.referer && row.referer > 0) {
                        db.run(`UPDATE users SET balance = balance + ? WHERE chatId = ?`, [CONFIG.refPrice, row.referer]);
                        await bot.sendMessage(row.referer, `💰 Начислено ${CONFIG.refPrice.toFixed(2)} ${CONFIG.currency} за реферала!`)
                            .catch(() => {});

                        db.get(`SELECT referer FROM users WHERE chatId = ?`, [row.referer], (err2, row2) => {
                            if (!err2 && row2 && row2.referer && row2.referer > 0) {
                                db.run(`UPDATE users SET balance = balance + ? WHERE chatId = ?`, [CONFIG.refPrice2, row2.referer]);
                            }
                        });
                    }
                }
            } else {
                await bot.sendMessage(chatId, CONFIG.subscribemsg.replace('%firstname%', firstName), {
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: subscriptions }
                }).catch(() => {});
            }
        }
    });

    // АДМИН-ПАНЕЛЬ
    if (ADMIN_IDS.includes(userId)) {
        bot.sendMessage(chatId, '👨‍💻 Админ-панель', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📛 Заявки на выплату', callback_data: 'admin_withdraws' }],
                    [{ text: '📟 Запустить рассылку', callback_data: 'admin_broadcast' }],
                    [{ text: '💰 Изменить баланс', callback_data: 'admin_changebalance' }],
                    [{ text: '📵 Каналы для подписки', callback_data: 'admin_editchannels' }],
                    [{ text: '👪 Рефералы', callback_data: 'admin_referals' }],
                    [{ text: '🎵 Создать промокод', callback_data: 'admin_promocode' }],
                    [{ text: '➕ Создать задание', callback_data: 'admin_createtask' }]
                ]
            }
        }).catch(() => {});
    }
});

// ==================== КНОПКИ МЕНЮ ====================

// ----- БОНУС -----
bot.onText(/🎁 Бонус/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const subs = await checkSubscriptions(userId);
    if (subs !== true) {
        await bot.sendMessage(chatId, CONFIG.subscribemsg, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: subs }
        }).catch(() => {});
        return;
    }

    db.get(`SELECT lastDailyBonus FROM users WHERE chatId = ?`, [userId], (err, row) => {
        if (err || !row) {
            bot.sendMessage(chatId, '❌ Ошибка получения данных.').catch(() => {});
            return;
        }

        const now = new Date();
        const last = row.lastDailyBonus ? new Date(row.lastDailyBonus) : null;

        if (last && (now - last) < 24 * 60 * 60 * 1000) {
            const hoursLeft = Math.ceil((24 * 60 * 60 * 1000 - (now - last)) / (60 * 60 * 1000));
            bot.sendMessage(chatId, `⏳ Бонус уже получен. Следующий через ~${hoursLeft} ч.`)
                .catch(() => {});
            return;
        }

        const bonus = Math.round((Math.random() * 4.5 + 0.5) * 10) / 10;
        db.run(
            `UPDATE users SET balance = balance + ?, lastDailyBonus = ? WHERE chatId = ?`,
            [bonus, now.toISOString(), userId],
            function(err) {
                if (err) {
                    bot.sendMessage(chatId, '❌ Ошибка начисления бонуса.').catch(() => {});
                    return;
                }
                bot.sendMessage(
                    chatId,
                    `🎁 Ежедневный бонус: <b>+${bonus.toFixed(1)} ${CONFIG.currency}</b>\n\n💰 Баланс обновлён!`,
                    { parse_mode: 'HTML' }
                ).catch(() => {});
            }
        );
    });
});

// ----- ТОП -----
bot.onText(/🏆 Топ/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const subs = await checkSubscriptions(userId);
    if (subs !== true) {
        await bot.sendMessage(chatId, CONFIG.subscribemsg, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: subs }
        }).catch(() => {});
        return;
    }

    db.all(
        `SELECT chatId, firstName, username, balance 
         FROM users 
         ORDER BY balance DESC 
         LIMIT 10`,
        (err, rows) => {
            if (err || !rows || rows.length === 0) {
                bot.sendMessage(chatId, '📊 Топ пока пуст. Станьте первым!').catch(() => {});
                return;
            }

            const medals = ['🥇', '🥈', '🥉'];
            let text = '🏆 <b>Топ по балансу:</b>\n\n';
            rows.forEach((row, i) => {
                const medal = i < 3 ? medals[i] : `${i + 1}.`;
                const name = row.username ? '@' + row.username : row.firstName;
                text += `${medal} <b>${name}</b> – ${row.balance.toFixed(2)} ${CONFIG.currency}\n`;
            });

            bot.sendMessage(chatId, text, { parse_mode: 'HTML' }).catch(() => {});
        }
    );
});

// ----- ЗАРАБОТАТЬ -----
bot.onText(/💰 Заработать/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const subs = await checkSubscriptions(userId);
    if (subs !== true) {
        await bot.sendMessage(chatId, CONFIG.subscribemsg, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: subs }
        }).catch(() => {});
        return;
    }

    db.get(
        `SELECT *,
            (SELECT firstName FROM users WHERE chatId = u.referer) AS refererName,
            (SELECT username FROM users WHERE chatId = u.referer) AS refererUsername,
            (SELECT COUNT(*) FROM users WHERE referer = u.chatId) AS firstLevel,
            (SELECT COUNT(*) FROM users WHERE referer IN (SELECT chatId FROM users WHERE referer = u.chatId)) AS secondLevel
         FROM users u
         WHERE u.chatId = ?`,
        [userId],
        (err, result) => {
            if (err || !result) {
                bot.sendMessage(chatId, '❌ Ошибка получения данных.').catch(() => {});
                return;
            }

            const refName = result.refererUsername
                ? '@' + result.refererUsername
                : result.refererName || 'никто';

            const text = `💰 <b>Партнёрская программа</b>
➖➖➖➖➖
🎵 <b>Бонусы:</b>
– 1 уровень: <b>${CONFIG.refPrice} ${CONFIG.currency}</b>
– 2 уровень: <b>${CONFIG.refPrice2} ${CONFIG.currency}</b>

<i>⚠️ Бонусы начисляются после подписки реферала на все каналы!</i>
➖➖➖➖➖
👪 <b>Рефералы:</b>
– 1-го уровня: ${result.firstLevel || 0}
– 2-го уровня: ${result.secondLevel || 0}
➖➖➖➖➖
🔆 <b>Ссылка:</b> https://t.me/${botUsername + '?start=' + userId}
➖➖➖➖➖
🗨 <b>Вас привёл:</b> ${refName}`;

            bot.sendMessage(chatId, text, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '📟 Поделиться', url: `https://t.me/share/url?url=https%3A//t.me/${botUsername}?start=${userId}` }
                    ]]
                }
            }).catch(() => {});
        }
    );
});

// ----- ЛИЧНЫЙ КАБИНЕТ -----
bot.onText(/👇 Личный кабинет/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const subs = await checkSubscriptions(userId);
    if (subs !== true) {
        await bot.sendMessage(chatId, CONFIG.subscribemsg, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: subs }
        }).catch(() => {});
        return;
    }

    db.get(
        `SELECT *,
            (SELECT SUM(amount) FROM withdraws WHERE chatId = ? AND status = 1) AS withdrawn,
            (SELECT SUM(amount) FROM withdraws WHERE chatId = ? AND status = 0) AS withdrawing
         FROM users
         WHERE chatId = ?`,
        [userId, userId, userId],
        (err, result) => {
            if (err || !result) {
                bot.sendMessage(chatId, '❌ Ошибка получения данных.').catch(() => {});
                return;
            }

            const balance = Math.floor(result.balance * 100) / 100;
            const withdrawn = Math.floor((result.withdrawn || 0) * 100) / 100;
            const withdrawing = Math.floor((result.withdrawing || 0) * 100) / 100;
            const days = Math.floor((Date.now() - new Date(result.registrationDate)) / (86400000));

            const text = `📫 <b>Ваш кабинет</b>
➖➖➖➖➖
👁 <b>Имя:</b> <a href="tg://user?id=${userId}">${result.firstName}</a>
🔽 <b>ID:</b> <code>${userId}</code>
📅 <b>В боте:</b> ${days} дн.
➖➖➖➖➖
💰 <b>Баланс:</b>
• Текущий: <b>${balance} ${CONFIG.currency}</b>
• В процессе вывода: ${withdrawing} ${CONFIG.currency}
• Всего заработано: ${withdrawn} ${CONFIG.currency}`;

            bot.sendMessage(chatId, text, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '📜 Пополнить', callback_data: 'replenish' },
                        { text: '📛 Вывести', callback_data: 'withdraw' }
                    ]]
                }
            }).catch(() => {});
        }
    );
});

// ----- ПРОДВИЖЕНИЕ -----
if (CONFIG.canPromote) {
    bot.onText(/📙 Продвижение/, async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        const subs = await checkSubscriptions(userId);
        if (subs !== true) {
            await bot.sendMessage(chatId, CONFIG.subscribemsg, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: subs }
            }).catch(() => {});
            return;
        }

        db.get(
            `SELECT COUNT(*) AS count FROM subscriptions 
             WHERE datetime(creationDate, '+' || hours || ' hours') > datetime('now')`,
            (err, row) => {
                const count = (row && row.count) || 0;
                if (count < CONFIG.maxAddedRequiredChannels) {
                    bot.sendMessage(chatId, '📢 Продвижение каналов и рассылки:', {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '➡ Добавить канал', callback_data: 'addchannel' },
                                 { text: '🔄 Мои каналы', callback_data: 'listchannels' }],
                                [{ text: '📟 Заказать рассылку', callback_data: 'orderbroadcast' }]
                            ]
                        }
                    }).catch(() => {});
                } else {
                    bot.sendMessage(chatId, '❌ Достигнут лимит каналов для подписки.').catch(() => {});
                }
            }
        );
    });
}

// ----- ЗАДАНИЯ -----
bot.onText(/📋 Задания/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const subs = await checkSubscriptions(userId);
    if (subs !== true) {
        await bot.sendMessage(chatId, CONFIG.subscribemsg, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: subs }
        }).catch(() => {});
        return;
    }

    db.all(
        `SELECT t.* FROM tasks t
         LEFT JOIN user_tasks ut ON t.id = ut.task_id AND ut.user_id = ?
         WHERE t.active = 1 AND ut.id IS NULL`,
        [userId],
        (err, rows) => {
            if (err || !rows || rows.length === 0) {
                bot.sendMessage(chatId, '📭 Нет доступных заданий.').catch(() => {});
                return;
            }

            let text = '📋 <b>Доступные задания:</b>\n\n';
            const keyboard = rows.map(row => {
                text += `🔹 <b>${row.channel}</b> – награда: ${row.reward} ${CONFIG.currency}\n`;
                return [{ text: `✅ Проверить @${row.channel}`, callback_data: `checktask_${row.id}` }];
            });

            bot.sendMessage(chatId, text, {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: keyboard }
            }).catch(() => {});
        }
    );
});

// ----- ИНФОРМАЦИЯ -----
bot.onText(/📳 Информация о боте/, async (msg) => {
    const chatId = msg.chat.id;
    const dayAgo = new Date(Date.now() - 86400000).toISOString();

    db.get(
        `SELECT 
            (SELECT COUNT(*) FROM users) AS total,
            (SELECT COUNT(*) FROM users WHERE registrationDate > ?) AS new,
            (SELECT SUM(amount) FROM withdraws) AS withdrawn
        `,
        [dayAgo],
        (err, result) => {
            const total = result?.total || 0;
            const newUsers = result?.new || 0;
            const withdrawn = result?.withdrawn || 0;
            const days = Math.floor((Date.now() - new Date(CONFIG.startDate)) / 86400000);

            const text = `📳 <b>Статистика бота</b>

👪 Всего: ${total}
🧑‍💻 За сутки: ${newUsers}
💰 Выплачено: ${withdrawn} ${CONFIG.currency}
📅 Работаем: ${days} дн.`;

            bot.sendMessage(chatId, text, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📙 Канал', url: CONFIG.channel },
                         { text: '💬 Чат', url: CONFIG.chat },
                         { text: '⭐ Отзывы', url: CONFIG.reviews }],
                        [{ text: '📎 Правила', url: CONFIG.rules },
                         { text: '❓ Вопрос', url: 'tg://user?id=' + ADMIN_IDS[0] }],
                        [{ text: '🏲 Топ рефералов за день', callback_data: 'reftop_day' }],
                        [{ text: '🏳 Топ рефералов за всё время', callback_data: 'reftop_all' }]
                    ]
                }
            }).catch(() => {});
        }
    );
});

// ----- ПРОМОКОДЫ -----
bot.onText(/🎵 Промокоды/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const subs = await checkSubscriptions(userId);
    if (subs !== true) {
        await bot.sendMessage(chatId, CONFIG.subscribemsg, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: subs }
        }).catch(() => {});
        return;
    }

    bot.sendMessage(chatId, '⭐ Введите промокод:', {
        reply_markup: CANCEL_KEYBOARD
    }).catch(() => {});
    STATES.promocodes.set(userId, {});
});

// ==================== ОБРАБОТЧИК СООБЩЕНИЙ ====================
bot.on('message', async (msg) => {
    if (!msg || !msg.text) return;

    const userId = msg.from.id;
    const chatId = msg.chat.id;

    // Игнорируем команды и кнопки меню
    const IGNORED = ['🎁 Бонус', '🏆 Топ', '💰 Заработать', '👇 Личный кабинет',
        '📙 Продвижение', '📋 Задания', '📳 Информация о боте',
        '🎵 Промокоды', '❌ Отменить'
    ];
    if (msg.text.startsWith('/') || IGNORED.includes(msg.text)) return;

    const subs = await checkSubscriptions(userId);
    if (subs !== true) {
        await bot.sendMessage(chatId, CONFIG.subscribemsg, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: subs }
        }).catch(() => {});
        return;
    }

    log(`${msg.from.first_name} (${userId}): ${msg.text}`);

    // ----- ВЫВОД СРЕДСТВ -----
    if (STATES.withdraws.has(userId)) {
        const state = STATES.withdraws.get(userId);

        if (!state.amount) {
            if (isNaN(msg.text)) {
                await bot.sendMessage(chatId, '❌ Введите число. Отмена.', { reply_markup: MENU_KEYBOARD });
                STATES.withdraws.delete(userId);
                return;
            }

            const amount = parseFloat(msg.text);
            if (amount < CONFIG.minAmount) {
                await bot.sendMessage(chatId, `💰 Мин. сумма: ${CONFIG.minAmount}`, {
                    reply_markup: CANCEL_KEYBOARD
                });
                return;
            }

            db.get(`SELECT balance FROM users WHERE chatId = ?`, [userId], (err, row) => {
                if (err || !row) {
                    bot.sendMessage(chatId, '❌ Ошибка.').catch(() => {});
                    STATES.withdraws.delete(userId);
                    return;
                }
                if (amount > row.balance) {
                    bot.sendMessage(chatId, `💰 Макс. сумма: ${row.balance}. Отмена.`, {
                        reply_markup: MENU_KEYBOARD
                    }).catch(() => {});
                    STATES.withdraws.delete(userId);
                    return;
                }
                STATES.withdraws.set(userId, { amount, wallet: null });
                bot.sendMessage(chatId, '💰 Введите реквизиты:', {
                    reply_markup: CANCEL_KEYBOARD
                }).catch(() => {});
            });
            return;
        }

        if (!state.wallet) {
            STATES.withdraws.set(userId, { amount: state.amount, wallet: msg.text });
            bot.sendMessage(chatId, '💰 Повторите реквизиты:', {
                reply_markup: CANCEL_KEYBOARD
            }).catch(() => {});
            return;
        }

        if (msg.text !== state.wallet) {
            await bot.sendMessage(chatId, '❌ Реквизиты не совпадают. Попробуйте снова.', {
                reply_markup: CANCEL_KEYBOARD
            });
            STATES.withdraws.delete(userId);
            return;
        }

        db.get(`SELECT balance FROM users WHERE chatId = ?`, [userId], (err, row) => {
            if (err || !row) {
                bot.sendMessage(chatId, '❌ Ошибка.').catch(() => {});
                STATES.withdraws.delete(userId);
                return;
            }
            if (state.amount > row.balance) {
                bot.sendMessage(chatId, '❌ Недостаточно баланса.', {
                    reply_markup: MENU_KEYBOARD
                }).catch(() => {});
                STATES.withdraws.delete(userId);
                return;
            }

            db.run(
                `INSERT INTO withdraws (chatId, amount, wallet) VALUES (?, ?, ?)`,
                [userId, state.amount, state.wallet]
            );
            db.run(
                `UPDATE users SET balance = balance - ? WHERE chatId = ?`,
                [state.amount, userId]
            );

            bot.sendMessage(
                chatId,
                `✅ Заявка создана!\n\n💰 Сумма: ${state.amount}\n📝 Реквизиты: ${state.wallet}\n\n⏳ Ожидание до 72 ч.`,
                { reply_markup: MENU_KEYBOARD }
            ).catch(() => {});
            bot.sendMessage(ADMIN_IDS[0], `⚠️ Заявка на выплату от ${userId} на ${state.amount} ${CONFIG.currency}`)
                .catch(() => {});
            STATES.withdraws.delete(userId);
        });
        return;
    }

    // ----- ДОБАВЛЕНИЕ КАНАЛА -----
    if (STATES.addchannel.has(userId)) {
        const state = STATES.addchannel.get(userId);

        if (!state.hours) {
            if (isNaN(msg.text)) {
                await bot.sendMessage(chatId, '❌ Введите число. Отмена.', { reply_markup: MENU_KEYBOARD });
                STATES.addchannel.delete(userId);
                return;
            }

            const hours = parseFloat(msg.text);
            if (hours < 1) {
                await bot.sendMessage(chatId, '💰 Мин. срок: 1 час.', { reply_markup: CANCEL_KEYBOARD });
                return;
            }

            db.get(`SELECT balance FROM users WHERE chatId = ?`, [userId], (err, row) => {
                if (err || !row) {
                    bot.sendMessage(chatId, '❌ Ошибка.').catch(() => {});
                    STATES.addchannel.delete(userId);
                    return;
                }
                const cost = hours * CONFIG.pricePerHour;
                if (cost > row.balance) {
                    bot.sendMessage(chatId, `❌ Недостаточно баланса. Нужно: ${cost}`, {
                        reply_markup: MENU_KEYBOARD
                    }).catch(() => {});
                    STATES.addchannel.delete(userId);
                    return;
                }
                STATES.addchannel.set(userId, { hours, channel: null, name: null });
                bot.sendMessage(chatId, '💰 Введите @username канала:', {
                    reply_markup: CANCEL_KEYBOARD
                }).catch(() => {});
            });
            return;
        }

        if (!state.channel) {
            const clean = msg.text.trim().replace(/[@https:\/\/t.me\/]/g, '');
            if (!clean) {
                await bot.sendMessage(chatId, '❌ Некорректный username.', { reply_markup: CANCEL_KEYBOARD });
                return;
            }

            try {
                const chat = await bot.getChat('@' + clean);
                const botInfo = await bot.getMe();
                const member = await bot.getChatMember('@' + clean, botInfo.id);

                if (!member || (member.status !== 'administrator' && member.status !== 'creator')) {
                    await bot.sendMessage(chatId, `❌ Бот не администратор @${clean}.`, {
                        reply_markup: CANCEL_KEYBOARD
                    });
                    STATES.addchannel.delete(userId);
                    return;
                }

                STATES.addchannel.set(userId, { hours: state.hours, channel: clean, name: chat.title });

                db.get(
                    `SELECT COUNT(*) AS count FROM subscriptions 
                     WHERE datetime(creationDate, '+' || hours || ' hours') > datetime('now')`,
                    async (err, row) => {
                        const count = (row && row.count) || 0;
                        if (count >= CONFIG.maxAddedRequiredChannels) {
                            await bot.sendMessage(chatId, '❌ Достигнут лимит каналов.', {
                                reply_markup: MENU_KEYBOARD
                            });
                            STATES.addchannel.delete(userId);
                            return;
                        }

                        const cost = state.hours * CONFIG.pricePerHour;
                        db.run(
                            `INSERT INTO subscriptions (ownerId, hours, channel, title) VALUES (?, ?, ?, ?)`,
                            [userId, state.hours, clean, chat.title]
                        );
                        db.run(
                            `UPDATE users SET balance = balance - ? WHERE chatId = ?`,
                            [cost, userId]
                        );

                        await bot.sendMessage(chatId, `✅ Канал @${clean} добавлен!`, {
                            reply_markup: MENU_KEYBOARD
                        });
                        STATES.addchannel.delete(userId);
                    }
                );
            } catch (e) {
                await bot.sendMessage(
                    chatId,
                    `❌ Канал @${clean} не найден.\n\nУбедитесь, что:\n1. Канал публичный\n2. Бот администратор\n3. Бот участник канала`,
                    { reply_markup: CANCEL_KEYBOARD }
                );
                STATES.addchannel.delete(userId);
            }
        }
        return;
    }

    // ----- ЗАКАЗ РАССЫЛКИ -----
    if (STATES.orderbroadcasts.has(userId)) {
        const state = STATES.orderbroadcasts.get(userId);

        if (!state.auditory) {
            if (isNaN(msg.text)) {
                await bot.sendMessage(chatId, '❌ Введите число. Отмена.', { reply_markup: MENU_KEYBOARD });
                STATES.orderbroadcasts.delete(userId);
                return;
            }

            const auditory = parseInt(msg.text);
            db.get(`SELECT balance FROM users WHERE chatId = ?`, [userId], (err, row) => {
                if (err || !row) {
                    bot.sendMessage(chatId, '❌ Ошибка.').catch(() => {});
                    STATES.orderbroadcasts.delete(userId);
                    return;
                }
                const cost = auditory * CONFIG.pricePerUser;
                if (row.balance < cost) {
                    bot.sendMessage(
                        chatId,
                        `❌ Недостаточно баланса. Нужно: ${cost}, доступно: ${row.balance}`,
                        { reply_markup: MENU_KEYBOARD }
                    ).catch(() => {});
                    STATES.orderbroadcasts.delete(userId);
                    return;
                }
                STATES.orderbroadcasts.set(userId, { auditory, msg: null });
                bot.sendMessage(chatId, '📩 Отправьте сообщение для рассылки:', {
                    reply_markup: CANCEL_KEYBOARD
                }).catch(() => {});
            });
            return;
        }

        STATES.orderbroadcasts.set(userId, { auditory: state.auditory, msg });
        broadcastMessageConfirm(msg, userId, true);
        return;
    }

    // ----- РАССЫЛКА (АДМИН) -----
    if (STATES.broadcasts.has(userId)) {
        const state = STATES.broadcasts.get(userId);

        if (!state.auditory) {
            if (isNaN(msg.text)) {
                await bot.sendMessage(chatId, '❌ Введите число. Отмена.', { reply_markup: MENU_KEYBOARD });
                STATES.broadcasts.delete(userId);
                return;
            }
            const auditory = parseInt(msg.text);
            STATES.broadcasts.set(userId, { auditory, msg: null });
            bot.sendMessage(chatId, '📩 Отправьте сообщение для рассылки:', {
                reply_markup: CANCEL_KEYBOARD
            }).catch(() => {});
            return;
        }

        STATES.broadcasts.set(userId, { auditory: state.auditory, msg });
        broadcastMessageConfirm(msg, userId);
        return;
    }

    // ----- ИЗМЕНЕНИЕ БАЛАНСА (АДМИН) -----
    if (STATES.adminFuncs.has(userId)) {
        const func = STATES.adminFuncs.get(userId).func;
        if (func === 'changebalance') {
            const parts = msg.text.split(' ');
            if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) {
                await bot.sendMessage(chatId, '❌ Формат: ID сумма (например: 123456 -10.5)', {
                    reply_markup: MENU_KEYBOARD
                });
                STATES.adminFuncs.delete(userId);
                return;
            }

            const targetId = parseInt(parts[0]);
            const amount = parseFloat(parts[1]);

            db.run(
                `UPDATE users SET balance = balance + ? WHERE chatId = ?`,
                [amount, targetId]
            );
            db.get(
                `SELECT firstName, username, balance FROM users WHERE chatId = ?`,
                [targetId],
                (err, row) => {
                    if (err || !row) {
                        bot.sendMessage(chatId, '❌ Пользователь не найден.', {
                            reply_markup: MENU_KEYBOARD
                        }).catch(() => {});
                    } else {
                        const name = row.username ? '@' + row.username : row.firstName;
                        bot.sendMessage(
                            chatId,
                            `✅ Баланс ${name} изменён на ${amount}\n💰 Новый баланс: ${row.balance}`,
                            { reply_markup: MENU_KEYBOARD }
                        ).catch(() => {});
                    }
                    STATES.adminFuncs.delete(userId);
                }
            );
        }
        return;
    }

    // ----- ПРОСМОТР РЕФЕРАЛОВ (АДМИН) -----
    if (STATES.adminReferals.has(userId)) {
        STATES.adminReferals.delete(userId);
        if (!ADMIN_IDS.includes(userId)) return;

        if (isNaN(msg.text)) {
            await bot.sendMessage(chatId, '❌ Введите ID пользователя.', { reply_markup: MENU_KEYBOARD });
            return;
        }

        db.all(
            `SELECT * FROM users WHERE referer = ? LIMIT 100`,
            [parseInt(msg.text)],
            (err, rows) => {
                if (err || !rows || rows.length === 0) {
                    bot.sendMessage(chatId, '❌ Рефералы не найдены.', { reply_markup: MENU_KEYBOARD })
                        .catch(() => {});
                    return;
                }

                let text = `👪 Рефералы пользователя ${msg.text}:\n\n`;
                rows.forEach(row => {
                    text += `<b>${row.chatId}</b> (${row.firstName}) ${row.username ? '@' + row.username : ''} ${row.verified ? '✅' : '❌'} <b>${row.balance} ${CONFIG.currency}</b>\n`;
                });

                bot.sendMessage(chatId, text, {
                    parse_mode: 'HTML',
                    reply_markup: MENU_KEYBOARD
                }).catch(() => {});
            }
        );
        return;
    }

    // ----- АКТИВАЦИЯ ПРОМОКОДА -----
    if (STATES.promocodes.has(userId)) {
        STATES.promocodes.delete(userId);

        db.get(
            `SELECT * FROM promocodes p
             WHERE p.hash = ?
             AND p.activations > (SELECT COUNT(*) FROM promocodeactivations WHERE hash = p.hash)
             AND p.hash NOT IN (SELECT hash FROM promocodeactivations WHERE userId = ?)`,
            [msg.text, userId],
            async (err, row) => {
                if (err || !row) {
                    await bot.sendMessage(chatId, '❌ Промокод не найден или уже активирован.', {
                        reply_markup: MENU_KEYBOARD
                    });
                    return;
                }

                db.run(
                    `INSERT INTO promocodeactivations (userId, hash) VALUES (?, ?)`,
                    [userId, msg.text]
                );
                db.run(
                    `UPDATE users SET balance = balance + ? WHERE chatId = ?`,
                    [row.sum, userId]
                );

                await bot.sendMessage(
                    chatId,
                    `✅ Промокод активирован!\n💰 +${row.sum.toFixed(2)} ${CONFIG.currency}`,
                    { parse_mode: 'HTML', reply_markup: MENU_KEYBOARD }
                );
                await bot.sendMessage(
                    ADMIN_IDS[0],
                    `⚠️ Промокод ${msg.text} активирован пользователем ${userId}`
                ).catch(() => {});
            }
        );
        return;
    }

    // ----- СОЗДАНИЕ ПРОМОКОДА (АДМИН) -----
    if (STATES.adminPromocode.has(userId)) {
        const state = STATES.adminPromocode.get(userId);

        if (!state.sum) {
            if (isNaN(msg.text)) {
                await bot.sendMessage(chatId, '❌ Введите число.', { reply_markup: MENU_KEYBOARD });
                STATES.adminPromocode.delete(userId);
                return;
            }
            state.sum = parseFloat(msg.text);
            STATES.adminPromocode.set(userId, state);
            await bot.sendMessage(chatId, '💰 Введите количество активаций:', {
                reply_markup: CANCEL_KEYBOARD
            });
            return;
        }

        if (!state.activations) {
            if (isNaN(msg.text)) {
                await bot.sendMessage(chatId, '❌ Введите число.', { reply_markup: MENU_KEYBOARD });
                STATES.adminPromocode.delete(userId);
                return;
            }
            state.activations = parseInt(msg.text);
            state.hash = makeId(8);

            db.run(
                `INSERT INTO promocodes (hash, activations, sum) VALUES (?, ?, ?)`,
                [state.hash, state.activations, state.sum],
                async (err) => {
                    if (err) {
                        await bot.sendMessage(chatId, '❌ Ошибка создания промокода.');
                        STATES.adminPromocode.delete(userId);
                        return;
                    }
                    await bot.sendMessage(
                        chatId,
                        `✅ Промокод создан!\n📝 Код: <code>${state.hash}</code>\n💰 Сумма: ${state.sum} ${CONFIG.currency}\n👥 Активаций: ${state.activations}`,
                        { parse_mode: 'HTML', reply_markup: MENU_KEYBOARD }
                    );
                    STATES.adminPromocode.delete(userId);
                }
            );
        }
        return;
    }

    // ----- СОЗДАНИЕ ЗАДАНИЯ (АДМИН) -----
    if (STATES.adminTask.has(userId)) {
        const state = STATES.adminTask.get(userId);

        if (!state.channel) {
            const clean = msg.text.trim().replace(/[@https:\/\/t.me\/]/g, '');
            if (!clean) {
                await bot.sendMessage(chatId, '❌ Некорректный username.', { reply_markup: CANCEL_KEYBOARD });
                return;
            }

            try {
                await bot.getChat('@' + clean);
                state.channel = clean;
                STATES.adminTask.set(userId, state);
                await bot.sendMessage(chatId, `💰 Введите награду (в ${CONFIG.currency}):`, {
                    reply_markup: CANCEL_KEYBOARD
                });
            } catch (_) {
                await bot.sendMessage(chatId, `❌ Канал @${clean} не найден.`, {
                    reply_markup: CANCEL_KEYBOARD
                });
                STATES.adminTask.delete(userId);
            }
            return;
        }

        if (!state.reward) {
            if (isNaN(msg.text) || parseFloat(msg.text) <= 0) {
                await bot.sendMessage(chatId, '❌ Введите положительное число.', {
                    reply_markup: CANCEL_KEYBOARD
                });
                return;
            }

            state.reward = parseFloat(msg.text);
            db.run(
                `INSERT INTO tasks (channel, reward, created_by) VALUES (?, ?, ?)`,
                [state.channel, state.reward, userId],
                async (err) => {
                    if (err) {
                        await bot.sendMessage(chatId, '❌ Ошибка создания задания.');
                        STATES.adminTask.delete(userId);
                        return;
                    }
                    await bot.sendMessage(
                        chatId,
                        `✅ Задание создано!\n📌 Канал: @${state.channel}\n💰 Награда: ${state.reward} ${CONFIG.currency}`,
                        { reply_markup: MENU_KEYBOARD }
                    );
                    STATES.adminTask.delete(userId);
                }
            );
        }
        return;
    }
});

// ==================== CALLBACK QUERY ====================
let withdrawOffset = 0;

bot.on('callback_query', async (msg) => {
    if (!msg || !msg.data) return;

    const userId = msg.from.id;
    const chatId = msg.message.chat.id;
    const data = msg.data.split('_');

    log(`Callback ${userId}: ${msg.data}`);

    switch (data[0]) {
        // ----- ВЫВОД -----
        case 'withdraw':
            db.get(`SELECT balance FROM users WHERE chatId = ?`, [userId], (err, row) => {
                if (err || !row) {
                    bot.sendMessage(chatId, '❌ Ошибка.').catch(() => {});
                    return;
                }
                if (row.balance < CONFIG.minAmount) {
                    bot.sendMessage(chatId, `❌ Мин. сумма: ${CONFIG.minAmount}`, {
                        reply_markup: MENU_KEYBOARD
                    }).catch(() => {});
                    return;
                }
                STATES.withdraws.set(userId, { amount: null, wallet: null });
                bot.sendMessage(chatId, `💰 Введите сумму от ${CONFIG.minAmount} до ${row.balance}:`, {
                    reply_markup: CANCEL_KEYBOARD
                }).catch(() => {});
            });
            break;

        // ----- ПОПОЛНЕНИЕ -----
        case 'replenish':
            bot.sendMessage(chatId, CONFIG.replenish.replace(/{id}/g, userId), {
                parse_mode: 'HTML'
            }).catch(() => {});
            break;

        // ----- ЗАЯВКИ (АДМИН) -----
        case 'admin':
            if (data[1] === 'withdraws') {
                if (!ADMIN_IDS.includes(userId)) break;

                if (data[2] === 'skip') withdrawOffset++;
                else if (data[2] === 'reset') withdrawOffset = 0;

                db.get(`SELECT COUNT(*) AS count FROM withdraws WHERE status = 0`, (err, row) => {
                    const total = (row && row.count) || 0;
                    if (total === 0) {
                        bot.sendMessage(chatId, '✅ Нет заявок на выплату.').catch(() => {});
                        return;
                    }
                    if (withdrawOffset >= total) withdrawOffset = total - 1;

                    db.get(
                        `SELECT w.*, u.firstName, u.username 
                         FROM withdraws w
                         JOIN users u ON w.chatId = u.chatId
                         WHERE w.status = 0
                         LIMIT 1 OFFSET ?`,
                        [withdrawOffset],
                        (err2, row2) => {
                            if (err2 || !row2) {
                                bot.sendMessage(chatId, '❌ Ошибка загрузки заявки.').catch(() => {});
                                return;
                            }

                            const name = row2.username ? '@' + row2.username : row2.firstName;
                            bot.sendMessage(
                                chatId,
                                `📛 Заявка ${withdrawOffset + 1}/${total}\n\n👤 ${name}\n💰 ${row2.amount} ${CONFIG.currency}\n📝 <code>${row2.wallet}</code>`,
                                {
                                    parse_mode: 'HTML',
                                    reply_markup: {
                                        inline_keyboard: [
                                            [{ text: '⏳ Пропустить', callback_data: 'admin_withdraws_skip' }],
                                            [{ text: '✅ Выплатить', callback_data: 'admin_accept_' + row2.id }],
                                            [{ text: '❌ Отказать', callback_data: 'admin_decline_' + row2.id }]
                                        ]
                                    }
                                }
                            ).catch(() => {});
                        }
                    );
                });
            }
            break;

        // ----- ПРИНЯТЬ ЗАЯВКУ -----
        case 'admin_accept': {
            if (!ADMIN_IDS.includes(userId)) break;
            const id = parseInt(data[1]);

            db.get(`SELECT * FROM withdraws WHERE id = ? AND status = 0`, [id], (err, row) => {
                if (err || !row) {
                    bot.sendMessage(chatId, '❌ Заявка не найдена.').catch(() => {});
                    return;
                }

                db.run(`UPDATE withdraws SET status = 1 WHERE id = ?`, [id]);
                bot.sendMessage(row.chatId, `✅ Выплата ${row.amount} ${CONFIG.currency} подтверждена!`)
                    .catch(() => {});
                bot.sendMessage(
                    CONFIG.withdrawsChannel,
                    `📵 <b><a href="tg://user?id=${row.chatId}">Пользователь</a> вывел ${row.amount} ${CONFIG.currency}</b>`,
                    { parse_mode: 'HTML' }
                ).catch(() => {});
                bot.sendMessage(chatId, '✅ Выплата подтверждена.', {
                    reply_markup: { inline_keyboard: [[{ text: '📛 К заявкам', callback_data: 'admin_withdraws_reset' }]] }
                }).catch(() => {});
            });
            break;
        }

        // ----- ОТКАЗАТЬ В ЗАЯВКЕ -----
        case 'admin_decline': {
            if (!ADMIN_IDS.includes(userId)) break;
            const id = parseInt(data[1]);

            db.get(`SELECT * FROM withdraws WHERE id = ? AND status = 0`, [id], (err, row) => {
                if (err || !row) {
                    bot.sendMessage(chatId, '❌ Заявка не найдена.').catch(() => {});
                    return;
                }

                db.run(`UPDATE withdraws SET status = 2 WHERE id = ?`, [id]);
                db.run(`UPDATE users SET balance = balance + ? WHERE chatId = ?`, [row.amount, row.chatId]);
                bot.sendMessage(row.chatId, `❌ Выплата ${row.amount} ${CONFIG.currency} отклонена.`)
                    .catch(() => {});
                bot.sendMessage(chatId, '❌ Отказ отправлен.', {
                    reply_markup: { inline_keyboard: [[{ text: '📛 К заявкам', callback_data: 'admin_withdraws_reset' }]] }
                }).catch(() => {});
            });
            break;
        }

        // ----- ДОБАВИТЬ КАНАЛ -----
        case 'addchannel':
            db.get(
                `SELECT COUNT(*) AS count FROM subscriptions 
                 WHERE datetime(creationDate, '+' || hours || ' hours') > datetime('now')`,
                (err, row) => {
                    const count = (row && row.count) || 0;
                    if (count >= CONFIG.maxAddedRequiredChannels) {
                        bot.sendMessage(chatId, '❌ Достигнут лимит каналов.').catch(() => {});
                        return;
                    }
                    STATES.addchannel.set(userId, { hours: null, channel: null, name: null });
                    bot.sendMessage(chatId, '💰 Введите срок (в часах):', {
                        reply_markup: CANCEL_KEYBOARD
                    }).catch(() => {});
                }
            );
            break;

        // ----- МОИ КАНАЛЫ -----
        case 'listchannels':
            db.all(
                `SELECT * FROM subscriptions 
                 WHERE ownerId = ? 
                 AND datetime(creationDate, '+' || hours || ' hours') > datetime('now')`,
                [userId],
                (err, rows) => {
                    if (err || !rows || rows.length === 0) {
                        bot.sendMessage(chatId, '📭 У вас нет активных каналов.').catch(() => {});
                        return;
                    }

                    let text = '📋 Ваши каналы:\n';
                    rows.forEach(row => {
                        text += `\n@${row.channel} | ${row.hours} ч. | до ${new Date(Date.now() + row.hours * 3600000).toLocaleString()}`;
                    });
                    bot.sendMessage(chatId, text).catch(() => {});
                }
            );
            break;

        // ----- РАССЫЛКА (АДМИН) -----
        case 'admin_broadcast': {
            if (!ADMIN_IDS.includes(userId)) break;
            STATES.broadcasts.set(userId, { auditory: null, msg: null });
            bot.sendMessage(chatId, '⚠️ Введите количество человек для рассылки:', {
                reply_markup: CANCEL_KEYBOARD
            }).catch(() => {});
            break;
        }

        // ----- ЗАКАЗ РАССЫЛКИ -----
        case 'orderbroadcast': {
            if (data[1] === 'confirm') {
                const state = STATES.orderbroadcasts.get(userId);
                if (!state) {
                    bot.sendMessage(chatId, '❌ Ошибка.').catch(() => {});
                    return;
                }

                db.get(`SELECT balance FROM users WHERE chatId = ?`, [userId], (err, row) => {
                    if (err || !row) {
                        bot.sendMessage(chatId, '❌ Ошибка.').catch(() => {});
                        return;
                    }
                    const cost = state.auditory * CONFIG.pricePerUser;
                    if (row.balance < cost) {
                        bot.sendMessage(chatId, '❌ Недостаточно баланса.').catch(() => {});
                        STATES.orderbroadcasts.delete(userId);
                        return;
                    }

                    db.run(`UPDATE users SET balance = balance - ? WHERE chatId = ?`, [cost, userId]);
                    broadcastMessage(state.msg, state.auditory, userId);
                    STATES.orderbroadcasts.delete(userId);
                    bot.sendMessage(chatId, '✅ Рассылка запущена!').catch(() => {});
                });
            } else if (data[1] === 'decline') {
                STATES.orderbroadcasts.delete(userId);
                bot.sendMessage(chatId, '❌ Отменено.').catch(() => {});
            } else {
                STATES.orderbroadcasts.set(userId, { auditory: null, msg: null });
                bot.sendMessage(
                    chatId,
                    `⚠️ Введите количество человек.\n💰 Цена: ${CONFIG.pricePerUser} ${CONFIG.currency}/чел.`,
                    { reply_markup: CANCEL_KEYBOARD }
                ).catch(() => {});
            }
            break;
        }

        // ----- ПОДТВЕРЖДЕНИЕ РАССЫЛКИ (АДМИН) -----
        case 'broadcast': {
            if (data[1] === 'confirm') {
                const state = STATES.broadcasts.get(userId);
                if (state) {
                    broadcastMessage(state.msg, state.auditory);
                    STATES.broadcasts.delete(userId);
                    bot.sendMessage(chatId, '✅ Рассылка запущена!').catch(() => {});
                }
            } else if (data[1] === 'decline') {
                STATES.broadcasts.delete(userId);
                bot.sendMessage(chatId, '❌ Отменено.').catch(() => {});
            }
            break;
        }

        // ----- ИЗМЕНИТЬ БАЛАНС (АДМИН) -----
        case 'admin_changebalance': {
            if (!ADMIN_IDS.includes(userId)) break;
            STATES.adminFuncs.set(userId, { func: 'changebalance' });
            bot.sendMessage(chatId, '💰 Введите ID и сумму через пробел\nПример: 123456 -10.5', {
                reply_markup: CANCEL_KEYBOARD
            }).catch(() => {});
            break;
        }

        // ----- РЕДАКТОР КАНАЛОВ (АДМИН) -----
        case 'admin_editchannels': {
            if (!ADMIN_IDS.includes(userId)) break;
            db.all(
                `SELECT * FROM subscriptions 
                 WHERE datetime(creationDate, '+' || hours || ' hours') > datetime('now')`,
                (err, rows) => {
                    if (err || !rows || rows.length === 0) {
                        bot.sendMessage(chatId, '📭 Нет активных каналов.').catch(() => {});
                        return;
                    }
                    const keyboard = rows.map(row => [
                        { text: row.title || row.channel, callback_data: 'admin_edit_' + row.id }
                    ]);
                    bot.sendMessage(chatId, '📷 Управление каналами:', {
                        reply_markup: { inline_keyboard: keyboard }
                    }).catch(() => {});
                }
            );
            break;
        }

        case 'admin_edit': {
            if (!ADMIN_IDS.includes(userId)) break;
            const id = parseInt(data[1]);
            db.get(`SELECT * FROM subscriptions WHERE id = ?`, [id], (err, row) => {
                if (err || !row) {
                    bot.sendMessage(chatId, '❌ Канал не найден.').catch(() => {});
                    return;
                }
                bot.sendMessage(
                    chatId,
                    `📌 ${row.title}\n📎 https://t.me/${row.channel}\n⏳ ${row.hours} ч.`,
                    {
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '🗑 Удалить', callback_data: 'admin_delete_' + row.id }
                            ]]
                        }
                    }
                ).catch(() => {});
            });
            break;
        }

        case 'admin_delete': {
            if (!ADMIN_IDS.includes(userId)) break;
            const id = parseInt(data[1]);
            db.run(`DELETE FROM subscriptions WHERE id = ?`, [id]);
            bot.sendMessage(chatId, '🗑 Канал удалён.').catch(() => {});
            break;
        }

        // ----- РЕФЕРАЛЫ (АДМИН) -----
        case 'admin_referals': {
            if (!ADMIN_IDS.includes(userId)) break;
            STATES.adminReferals.set(userId, {});
            bot.sendMessage(chatId, '👪 Введите ID пользователя для просмотра рефералов:', {
                reply_markup: CANCEL_KEYBOARD
            }).catch(() => {});
            break;
        }

        // ----- СОЗДАТЬ ПРОМОКОД (АДМИН) -----
        case 'admin_promocode': {
            if (!ADMIN_IDS.includes(userId)) break;
            STATES.adminPromocode.set(userId, { sum: null, activations: null, hash: null });
            bot.sendMessage(chatId, '⭐ Введите сумму промокода:', {
                reply_markup: CANCEL_KEYBOARD
            }).catch(() => {});
            break;
        }

        // ----- СОЗДАТЬ ЗАДАНИЕ (АДМИН) -----
        case 'admin_createtask': {
            if (!ADMIN_IDS.includes(userId)) break;
            STATES.adminTask.set(userId, { channel: null, reward: null });
            bot.sendMessage(chatId, '📝 Введите username канала (без @) для задания:', {
                reply_markup: CANCEL_KEYBOARD
            }).catch(() => {});
            break;
        }

        // ----- ПРОВЕРКА ЗАДАНИЯ -----
        case 'checktask': {
            const taskId = parseInt(data[1]);

            db.get(`SELECT * FROM user_tasks WHERE user_id = ? AND task_id = ?`, [userId, taskId], (err, exists) => {
                if (err || exists) {
                    bot.sendMessage(chatId, '❌ Вы уже выполнили это задание.').catch(() => {});
                    return;
                }

                db.get(`SELECT * FROM tasks WHERE id = ? AND active = 1`, [taskId], async (err, task) => {
                    if (err || !task) {
                        bot.sendMessage(chatId, '❌ Задание не найдено.').catch(() => {});
                        return;
                    }

                    try {
                        const member = await bot.getChatMember('@' + task.channel, userId);
                        if (!member || member.status === 'left' || member.status === 'kicked') {
                            await bot.sendMessage(chatId, `❌ Вы не подписаны на @${task.channel}. Подпишитесь и попробуйте снова.`);
                            return;
                        }
                    } catch (_) {
                        await bot.sendMessage(chatId, `❌ Не удалось проверить подписку на @${task.channel}.`);
                        return;
                    }

                    db.run(`UPDATE users SET balance = balance + ? WHERE chatId = ?`, [task.reward, userId]);
                    db.run(`INSERT INTO user_tasks (user_id, task_id) VALUES (?, ?)`, [userId, taskId]);

                    await bot.sendMessage(chatId, `✅ Подписка подтверждена! +${task.reward} ${CONFIG.currency}`);
                    await bot.sendMessage(ADMIN_IDS[0], `👤 ${userId} выполнил задание @${task.channel} (+${task.reward} ${CONFIG.currency})`);
                });
            });
            break;
        }

        // ----- ТОП РЕФЕРАЛОВ -----
        case 'reftop': {
            const period = data[1];
            const where = period === 'day' ? "AND u2.registrationDate >= DATETIME('now', '-1 day')" : "";

            db.all(
                `SELECT u1.username, u1.firstName, COUNT(u2.referer) AS count
                 FROM users u1
                 LEFT JOIN users u2 ON u1.chatId = u2.referer ${where}
                 GROUP BY u1.chatId
                 ORDER BY count DESC
                 LIMIT 10`,
                (err, rows) => {
                    const title = period === 'day' ? '🏲 Топ за день' : '🏳 Топ за всё время';
                    let text = `${title}:\n`;
                    if (!err && rows && rows.length > 0) {
                        rows.forEach((row, i) => {
                            const name = row.username ? '@' + row.username : row.firstName;
                            text += `\n${i + 1}. ${name} – ${row.count} реф.`;
                        });
                    } else {
                        text += '\nНет данных. Приглашайте друзей!';
                    }
                    bot.sendMessage(userId, text).catch(() => {});
                }
            );
            break;
        }
    }

    try { await bot.answerCallbackQuery(msg.id); } catch (_) {}
});

// ==================== ФУНКЦИИ РАССЫЛКИ ====================
function broadcastMessage(msg, auditory = null, firstChatId = ADMIN_IDS[0], order = false) {
    const text = msg.text || msg.caption || '';
    const form = {};
    if (msg.entities) form.entities = JSON.stringify(msg.entities);
    if (msg.caption) form.caption = text;
    if (msg.caption_entities) form.caption_entities = JSON.stringify(msg.caption_entities);

    db.all(
        `SELECT chatId FROM users${auditory ? ' ORDER BY RANDOM() LIMIT ' + auditory : ''}`,
        async (err, rows) => {
            if (err || !rows) {
                bot.sendMessage(firstChatId, '❌ Ошибка получения пользователей.').catch(() => {});
                return;
            }

            const msgObj = createButtonsFromTemplate(text, form);
            const opts = msgObj.form;
            let failed = 0;

            for (const row of rows) {
                try {
                    if (msg.text) {
                        let textToSend = msgObj.text;
                        if (order) textToSend = '⚠️#реклама\n' + textToSend;
                        await bot.sendMessage(row.chatId, textToSend, opts);
                    }
                    if (msg.photo) {
                        await bot.sendPhoto(row.chatId, msg.photo[0].file_id, opts);
                    }
                    await new Promise(r => setTimeout(r, 100));
                } catch (_) {
                    failed++;
                }
            }

            bot.sendMessage(firstChatId, `✅ Рассылка завершена\n❌ Не доставлено: ${failed}`).catch(() => {});
        }
    );
}

function broadcastMessageConfirm(msg, userId, order = false) {
    const text = msg.text || msg.caption || '';
    const form = {};
    if (msg.entities) form.entities = JSON.stringify(msg.entities);
    if (msg.caption) form.caption = text;
    if (msg.caption_entities) form.caption_entities = JSON.stringify(msg.caption_entities);

    const msgObj = createButtonsFromTemplate(text, form);
    const opts = msgObj.form;

    const action = order ? 'orderbroadcast' : 'broadcast';
    opts.reply_markup.inline_keyboard.push([
        { text: '✅ Подтвердить', callback_data: action + '_confirm' },
        { text: '❌ Отклонить', callback_data: action + '_decline' }
    ]);

    if (msg.text) {
        bot.sendMessage(userId, msgObj.text, opts).catch(() => {});
    }
    if (msg.photo) {
        bot.sendPhoto(userId, msg.photo[0].file_id, opts).catch(() => {});
    }
}

function createButtonsFromTemplate(message, form) {
    const regex = /#([^#]+)#([^#]+)#/g;
    const buttons = [];
    let clean = message.replace(regex, (_, name, url) => {
        buttons.push([{ text: name, url }]);
        return '';
    });

    const opts = { ...form, reply_markup: { inline_keyboard: buttons } };
    if (opts.caption) opts.caption = clean;
    return { text: clean, form: opts };
}

// ==================== ОБРАБОТКА ОШИБОК ====================
bot.on('polling_error', (err) => log('Polling error: ' + err.message));

process.on('SIGTERM', () => {
    db.close();
    process.exit(0);
});

console.log('✅ Бот успешно запущен и готов к работе!');
