# -*- coding: utf-8 -*-
import asyncio
import json
import os
import re
from aiogram import Bot, Dispatcher, F, Router, types
from aiogram.enums import ParseMode
from aiogram.filters import Command
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.context import FSMContext
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from aiogram.client.default import DefaultBotProperties
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.errors import SessionPasswordNeededError

TOKEN = '' # token @botfather
OWNER_ID =          # admin id
DATA_FILE = 'users.json'
SESSION_DIR = 'sessions'

os.makedirs(SESSION_DIR, exist_ok=True)

bot = Bot(token=TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
dp = Dispatcher(storage=MemoryStorage())
router = Router()
dp.include_router(router)

class Form(StatesGroup):
    add_user = State()
    api_id = State()
    api_hash = State()
    phone = State()
    code = State()
    password = State()
    text = State()
    chat_id = State()
    delete_chat = State()
    interval = State()


def load_users():
    if not os.path.exists(DATA_FILE):
        with open(DATA_FILE, 'w') as f:
            json.dump({}, f)
    with open(DATA_FILE) as f:
        return json.load(f)

def save_users(users):
    with open(DATA_FILE, 'w') as f:
        json.dump(users, f, indent=4)

def is_user(uid):
    users = load_users()
    return str(uid) in users or uid == OWNER_ID

def get_user(uid):
    return load_users().get(str(uid))

def set_user(uid, data):
    users = load_users()
    users[str(uid)] = data
    save_users(users)


def main_menu(is_admin=False):
    kb = [
        [InlineKeyboardButton(text="🔐 Добавить аккаунт", callback_data="input_api")],
        [InlineKeyboardButton(text="📨 Ввести текст", callback_data="text")],
        [InlineKeyboardButton(text="➕ Добавить канал", callback_data="chat_id"),
         InlineKeyboardButton(text="➖ Удалить канал", callback_data="del_chat")],
        [InlineKeyboardButton(text="▶️ Старт", callback_data="start"),
         InlineKeyboardButton(text="⏹ Стоп", callback_data="stop")],
        [InlineKeyboardButton(text="⚙️ Настройки", callback_data="settings"),
         InlineKeyboardButton(text="⏱ Интервал", callback_data="interval")],
        [InlineKeyboardButton(text="❓ Как пользоваться", callback_data="how_to_use")]  # добавлена кнопка "Как пользоваться"
    ]
    if is_admin:
        kb.append([InlineKeyboardButton(text="👑 Добавить", callback_data="add_user")])
    return InlineKeyboardMarkup(inline_keyboard=kb)


@router.message(Command("start"))
async def cmd_start(message: types.Message):
    if not is_user(message.from_user.id):
        await message.answer("Доступ запрещен")
        return
    await message.answer("Добро пожаловать!", reply_markup=main_menu(message.from_user.id == OWNER_ID))


@router.callback_query(F.data == "add_user")
async def add_user_start(call: types.CallbackQuery, state: FSMContext):
    if call.from_user.id != OWNER_ID:
        await call.answer("Только для админа.", show_alert=True)
        return
    await call.message.answer("Введи user_id пользователя для доступа:")
    await state.set_state(Form.add_user)

@router.message(Form.add_user)
async def add_user_finish(message: types.Message, state: FSMContext):
    try:
        uid = int(message.text.strip())
        users = load_users()
        if str(uid) in users:
            await message.answer("Пользователь уже есть.")
        else:
            users[str(uid)] = {}
            save_users(users)
            await message.answer("✅ Пользователь добавлен.")
    except:
        await message.answer("❌ Неверный user_id")
    await state.clear()


@router.callback_query(F.data == "input_api")
async def input_api_start(call: types.CallbackQuery, state: FSMContext):
    await call.message.answer("🔐 Введите ваш API ID:")
    await state.set_state(Form.api_id)

@router.message(Form.api_id)
async def input_api_hash(message: types.Message, state: FSMContext):
    await state.update_data(api_id=int(message.text.strip()))
    await message.answer("🔑 Теперь введите API Hash:")
    await state.set_state(Form.api_hash)

@router.message(Form.api_hash)
async def input_phone(message: types.Message, state: FSMContext):
    await state.update_data(api_hash=message.text.strip())
    await message.answer("📱 Введите ваш номер телефона в формате +7...")
    await state.set_state(Form.phone)

@router.message(Form.phone)
async def send_code_request(message: types.Message, state: FSMContext):
    data = await state.get_data()
    api_id = data["api_id"]
    api_hash = data["api_hash"]
    phone = message.text.strip()

    client = TelegramClient(StringSession(), api_id, api_hash)
    await client.connect()
    try:
        result = await client.send_code_request(phone)
        await state.update_data(phone=phone, session=client.session.save(), phone_code_hash=result.phone_code_hash)
        await message.answer("📩 Код отправлен. Введите его:")
        await state.set_state(Form.code)
    except Exception as e:
        await message.answer(f"❌ Ошибка отправки кода: {e}")
        await client.disconnect()

@router.message(Form.code)
async def input_code(message: types.Message, state: FSMContext):
    code = message.text.strip()
    data = await state.get_data()
    client = TelegramClient(StringSession(data['session']), data['api_id'], data['api_hash'])
    await client.connect()
    try:
        await client.sign_in(data['phone'], code, phone_code_hash=data['phone_code_hash'])
        set_user(message.from_user.id, {
            'api_id': data['api_id'],
            'api_hash': data['api_hash'],
            'session': client.session.save(),
            'text': 'Тестовое сообщение',
            'chats': [],
            'interval': 60
        })
        await message.answer("✅ Авторизация прошла успешно!")
        await state.clear()
    except SessionPasswordNeededError:
        await message.answer("🔒 Включена двухфакторная авторизация. Введите пароль:")
        await state.set_state(Form.password)
    except Exception as e:
        await message.answer(f"❌ Ошибка авторизации: {e}")
        await client.disconnect()

@router.message(Form.password)
async def input_2fa_password(message: types.Message, state: FSMContext):
    password = message.text.strip()
    data = await state.get_data()
    client = TelegramClient(StringSession(data['session']), data['api_id'], data['api_hash'])
    await client.connect()
    try:
        await client.sign_in(password=password)
        set_user(message.from_user.id, {
            'api_id': data['api_id'],
            'api_hash': data['api_hash'],
            'session': client.session.save(),
            'text': 'Тестовое сообщение',
            'chats': [],
            'interval': 60
        })
        await message.answer("✅ Авторизация прошла успешно!")
    except Exception as e:
        await message.answer(f"❌ Ошибка при вводе пароля: {e}")
    await client.disconnect()
    await state.clear()


@router.callback_query(F.data == "text")
async def set_text_start(call: types.CallbackQuery, state: FSMContext):
    await call.message.answer("✏️ Введите текст рассылки:")
    await state.set_state(Form.text)

@router.message(Form.text)
async def save_text(message: types.Message, state: FSMContext):
    user = get_user(message.from_user.id)
    user['text'] = message.text
    set_user(message.from_user.id, user)
    await message.answer("✅ Текст сохранён.")
    await state.clear()


@router.callback_query(F.data == "chat_id")
async def set_chat_id_start(call: types.CallbackQuery, state: FSMContext):
    await call.message.answer(
        "💬 Введите chat_id или @username канала/чата. Разделяйте пробелом, запятыми или переносами если их больше 1"

    )
    await state.set_state(Form.chat_id)

@router.message(Form.chat_id)
async def save_chat_id(message: types.Message, state: FSMContext):
    user = get_user(message.from_user.id)
    text = message.text.strip()
    # Разбиваем по запятым, пробелам, переносам
    items = re.split(r'[\s,]+', text)
    added = []
    duplicates = []

    for item in items:
        if not item:
            continue
        clean_item = item.lstrip('@')

        try:
            cid = int(clean_item)
            if cid not in user['chats']:
                user['chats'].append(cid)
                added.append(str(cid))
            else:
                duplicates.append(str(cid))
        except:
            username = '@' + clean_item
            if username not in user['chats']:
                user['chats'].append(username)
                added.append(username)
            else:
                duplicates.append(username)

    set_user(message.from_user.id, user)

    response = ""
    if added:
        response += "✅ Добавлены:\n" + "\n".join(added) + "\n"
    if duplicates:
        response += "⚠️ Уже были добавлены:\n" + "\n".join(duplicates) + "\n"
    if not added and not duplicates:
        response = "❌ Ничего не добавлено. Проверьте ввод."

    await message.answer(response)
    await state.clear()

@router.callback_query(F.data == "del_chat")
async def delete_chat_start(call: types.CallbackQuery, state: FSMContext):
    user = get_user(call.from_user.id)
    if not user['chats']:
        await call.message.answer("⚠️ Нет добавленных чатов.")
        return
    chat_list = '\n'.join(f"{i+1}. {cid}" for i, cid in enumerate(user['chats']))
    await call.message.answer(f"Введите номер чата для удаления:\n{chat_list}")
    await state.set_state(Form.delete_chat)

@router.message(Form.delete_chat)
async def delete_chat_finish(message: types.Message, state: FSMContext):
    user = get_user(message.from_user.id)
    try:
        idx = int(message.text.strip()) - 1
        cid = user['chats'].pop(idx)
        set_user(message.from_user.id, user)
        await message.answer(f"✅ Chat ID {cid} удалён.")
    except:
        await message.answer("❌ Неверный номер")
    await state.clear()

@router.callback_query(F.data == "settings")
async def view_settings(call: types.CallbackQuery):
    user = get_user(call.from_user.id)
    await call.message.answer(f"📨 Текст: {user.get('text')}\n💬 Чаты: {user.get('chats')}\n⏱ Интервал: {user.get('interval')} сек.")

@router.callback_query(F.data == "interval")
async def interval_start(call: types.CallbackQuery, state: FSMContext):
    await call.message.answer("⏱ Введите интервал между сообщениями в секундах:")
    await state.set_state(Form.interval)

@router.message(Form.interval)
async def interval_finish(message: types.Message, state: FSMContext):
    try:
        seconds = int(message.text.strip())
        user = get_user(message.from_user.id)
        user['interval'] = max(5, seconds)
        set_user(message.from_user.id, user)
        await message.answer(f"✅ Интервал установлен: {seconds} сек")
    except:
        await message.answer("❌ Введите число")
    await state.clear()

@router.callback_query(F.data == "how_to_use")
async def how_to_use_handler(call: types.CallbackQuery):
    instruction = (
        "**Подробная инструкция:**\n"
        "1. Войти в аккаунт через **API id** и **HASH**\n"
        "2. На аккаунте с которого должна идти рассылка войти в нужный канал\n"
        "3. Добавить в бота айди или @username канала\n"
        "4. После всех настроек запускаем"
    )
    await call.message.answer(instruction)


tasks = {}

async def send_loop(uid):
    user = get_user(uid)
    client = TelegramClient(StringSession(user['session']), user['api_id'], user['api_hash'])
    await client.connect()
    while True:
        for chat in user['chats']:
            try:
                await client.send_message(chat, user['text'])
            except Exception as e:
                print(f"Ошибка отправки: {e}")
        await asyncio.sleep(user.get('interval', 60))

@router.callback_query(F.data == "start")
async def start_sending(call: types.CallbackQuery):
    uid = call.from_user.id
    if uid in tasks and not tasks[uid].done():
        await call.message.answer("⚠️ Уже запущено.")
        return
    tasks[uid] = asyncio.create_task(send_loop(uid))
    await call.message.answer("🚀 Рассылка началась.")

@router.callback_query(F.data == "stop")
async def stop_sending(call: types.CallbackQuery):
    uid = call.from_user.id
    if uid in tasks:
        tasks[uid].cancel()
        await call.message.answer("🛑 Рассылка остановлена.")
    else:
        await call.message.answer("❗ Рассылка не запущена.")


async def main():
    await dp.start_polling(bot)

if __name__ == '__main__':
    asyncio.run(main())
