const https = require('https');
const fs = require('fs');
const path = require('path');
const { GetCard, dataEmitter } = require("./server.js");

// === Константы ===
const AUTO_UPDATE = true; // Флаг для автообновления
const clientUrl = 'https://raw.githubusercontent.com/WauDev/telegram-bot-wildberries/main/client.js';
const localVersionFilePath = path.join(__dirname, 'version.txt');
const localClientPath = path.join(__dirname, 'client.js');
const token = process.env.TELEGRAM_BOT_TOKEN; // Токен Telegram бота

// Переменные для контроля очереди и процесса
let isUpdating = false;
let isProcessing = false;
let messageQueue = [];

// === Функции для автообновления ===

// Функция для проверки версии файла
function checkVersion(callback) {
    https.get(clientUrl, (res) => {
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        res.on('end', () => {
            const remoteVersionMatch = data.match(/const VERSION = "(.*)"/);
            const remoteVersion = remoteVersionMatch ? remoteVersionMatch[1] : null;

            if (remoteVersion) {
                const localVersion = fs.existsSync(localVersionFilePath)
                    ? fs.readFileSync(localVersionFilePath, 'utf8').trim()
                    : null;

                if (localVersion !== remoteVersion) {
                    console.log(`Новая версия доступна: ${remoteVersion}`);
                    callback(true, data);
                } else {
                    callback(false);
                }
            }
        });
    }).on('error', (err) => {
        console.error('Ошибка при проверке версии:', err);
        callback(false);
    });
}

// Функция для обновления client.js
function updateClient(newCode) {
    fs.writeFileSync(localClientPath, newCode, 'utf8');
    const versionMatch = newCode.match(/const VERSION = "(.*)"/);
    const newVersion = versionMatch ? versionMatch[1] : '';
    fs.writeFileSync(localVersionFilePath, newVersion, 'utf8');
    console.log(`Файл client.js обновлен до версии ${newVersion}`);
}

// Функция для завершения работы бота
function terminateBot() {
    console.log('Все задачи выполнены. Завершение работы...');
    process.exit(0); // Завершение процесса
}

// === Основные функции бота ===

// Функция для обработки очереди
async function processQueue() {
    if (isProcessing || messageQueue.length === 0) {
        return;
    }

    isProcessing = true;
    const { chatId, articleMatches, senderId, queueMessageId, userMessageId } = messageQueue.shift();

    // Удаляем сообщение пользователя с артикулами
    try {
        await bot.deleteMessage(chatId, userMessageId);
    } catch (error) {
        console.error("Ошибка удаления сообщения пользователя:", error);
    }

    try {
        await processArticles(chatId, articleMatches, senderId);
    } catch (error) {
        console.error("Ошибка обработки очереди:", error);
    }

    isProcessing = false;
    processQueue(); // Продолжаем обработку следующего сообщения в очереди
}

// Функция для обработки всех артикулов в сообщении
async function processArticles(chatId, articles, senderId) {
    const totalArticles = articles.length;
    let completedArticles = 0;

    // Создаем сообщение о прогрессе
    let progressMessage = await bot.sendMessage(
        chatId,
        `Выполняется: ${articles[0]}\n\nВыполнено 0%\nОсталось ${
            totalArticles - completedArticles
        } из ${totalArticles}`
    );

    for (const article of articles) {
        try {
            await processArticle(chatId, article, senderId);
            completedArticles++;

            // Обновляем сообщение о прогрессе
            const percentComplete = Math.floor(
                (completedArticles / totalArticles) * 100
            );
            await bot.editMessageText(
                `Выполняется: ${article}\n\nВыполнено ${percentComplete}%\nОсталось ${
                    totalArticles - completedArticles
                } из ${totalArticles}`,
                { chat_id: chatId, message_id: progressMessage.message_id }
            );
        } catch (error) {
            console.error(`Ошибка обработки артикула ${article}:`, error);
            await bot.sendMessage(
                chatId,
                `Ошибка, данные для артикула ${article} не были получены.`
            );
            break;
        }
    }

    // Удаляем сообщение, когда все артикулы обработаны или произошла ошибка
    await bot.deleteMessage(chatId, progressMessage.message_id);
}

// Функция для обработки одного артикула
async function processArticle(chatId, article, senderId) {
    GetCard(article);

    return new Promise((resolve, reject) => {
        dataEmitter.once("dataReady", async (data) => {
            try {
                if (data.error_article) {
                    await bot.sendMessage(
                        chatId,
                        `Ошибка, данные для артикула ${article} не были получены.`
                    );
                    return reject(new Error(`Ошибка данных для артикула ${article}`));
                }

                // Формируем ответ для отправки в чат
                const caption = `<a href="https://www.wildberries.ru/catalog/${article}/detail.aspx?targetUrl=SG">${data.imt_name || "Без названия"}</a>\n\n` +
                                `Категория: ${data.subj_name}\n` +
                                `Цена: ${data.price}\n`;

                await bot.sendPhoto(chatId, data.Image_Link, { caption, parse_mode: "HTML" });
                resolve();
            } catch (error) {
                console.error("Ошибка обработки данных:", error);
                reject(error);
            }
        });

        dataEmitter.once("error", async (error) => {
            await bot.sendMessage(
                chatId,
                `Ошибка при получении данных: ${error.message}`
            );
            reject(error);
        });
    });
}

// === Логика для Telegram бота ===

const TelegramBot = require("node-telegram-bot-api");
const bot = new TelegramBot(token, { polling: true });

// Проверяем, что токен присутствует
if (!token) {
    console.error("Токен не найден в переменных окружения!");
    process.exit(1);
} else {
    console.log("Бот успешно запущен!");
}

// Команда для добавления чата в базу данных
bot.onText(/\/addchat/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (await isAdmin(chatId, userId)) {
        const chatData = database.chats_id[chatId];

        if (chatData) {
            bot.sendMessage(chatId, `Чат ${chatId} уже существует в базе данных.`);
        } else {
            const chatName = msg.chat.title || "Неизвестная группа";
            database.chats_id[chatId] = {
                name: chatName,
                threads_id: {},
            };
            saveDatabase();
            bot.sendMessage(chatId, `Чат ${chatId} добавлен в базу данных.`);
        }
    } else {
        bot.sendMessage(chatId, `У вас нет прав для выполнения этой команды.`);
    }
});

// === Основная функция для автообновления и работы бота ===
function main() {
    if (AUTO_UPDATE) {
        // Каждую минуту проверяем обновление
        setInterval(() => {
            checkVersion((isNewVersionAvailable, newCode) => {
                if (isNewVersionAvailable) {
                    console.log('Обновление обнаружено, ожидание выполнения задач...');

                    // Останавливаем добавление новых задач
                    isUpdating = true;

                    // Отправляем предупреждение в чаты при получении новых сообщений
                    bot.on('message', (msg) => {
                        if (isUpdating) {
                            bot.sendMessage(msg.chat.id, 'Производится обновление, повторите позже.');
                        }
                    });

                    // Ждем выполнения текущих задач и обновляем бот
                    if (messageQueue.length === 0 && !isProcessing) {
                        updateClient(newCode);
                        terminateBot();
                    } else {
                        const intervalId = setInterval(() => {
                            if (messageQueue.length === 0 && !isProcessing) {
                                clearInterval(intervalId);
                                updateClient(newCode);
                                terminateBot();
                            }
                        }, 1000); // Проверяем каждую секунду
                    }
                }
            });
        }, 60000); // Проверяем обновление каждую минуту
    }

    // Запуск основной логики бота
    bot.on("message", (msg) => {
        if (isUpdating) {
            bot.sendMessage(msg.chat.id, 'Производится обновление, повторите позже.');
            return;
        }

        const chatId = msg.chat.id;
        const messageText = msg.text || "";

        // Проверка артикулов
        const articleMatches = messageText.match(/\b\d{5,}\b/g);

        if (articleMatches && articleMatches.length > 0) {
            if (isProcessing) {
               
bot.sendMessage(chatId, 'В очереди есть неподтвержденные сообщения, пожалуйста, подождите.'); } else { messageQueue.push({ chatId, articleMatches, senderId: msg.from.id, queueMessageId: msg.message_id, userMessageId: msg.message_id, }); processQueue(); } } }); }
