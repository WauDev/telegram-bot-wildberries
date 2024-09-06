const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");
const { exec } = require('child_process');
const { GetCard, dataEmitter } = require("./server.js");

// Получаем токен из переменной окружения
const token = process.env.TELEGRAM_BOT_TOKEN;
const databaseFilePath = path.join(__dirname, "database.json");

// Создаем экземпляр бота
const bot = new TelegramBot(token, { polling: true });

// Проверяем, что токен присутствует
if (!token) {
  console.error("Токен не найден в переменных окружения!");
  process.exit(1);
} else console.log("Бот успешно запущен!");

const CLIENT_VERSION = "1.3.0 06.09.2024";
const SERVER_VERSION = "1.3.0 06.09.2024";

// Команда для получения информации о версиях и последнем обновлении
bot.onText(/\/lastupdate/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (await isAdmin(chatId, userId)) {
    const [clientVersion, clientUpdateDate] = CLIENT_VERSION.split(" ");
    const [serverVersion, serverUpdateDate] = SERVER_VERSION.split(" ");

    const response = `Текущая версия клиента: ${clientVersion}\n` +
                     `Текущая версия сервера: ${serverVersion}\n\n` +
                     `Последнее обновление клиента: ${clientUpdateDate}\n` +
                     `Последнее обновление сервера: ${serverUpdateDate}`;

    await bot.sendMessage(chatId, response);
  } else {
    await bot.sendMessage(chatId, `У вас нет прав для выполнения этой команды.`);
  }
});


// Загружаем базу данных
let database = { chats_id: {} };

function loadDatabase() {
  if (fs.existsSync(databaseFilePath)) {
    const rawData = fs.readFileSync(databaseFilePath);
    database = JSON.parse(rawData);
  } else {
    // Если файл не существует, создаем пустую базу данных
    fs.writeFileSync(databaseFilePath, JSON.stringify(database, null, 2));
  }
}

function saveDatabase() {
  fs.writeFileSync(databaseFilePath, JSON.stringify(database, null, 2));
}

// Очередь сообщений для обработки
const messageQueue = [];
let isProcessing = false;

// Обрабатываем команды
bot.onText(/\/database/, (msg) => {
  const chatId = msg.chat.id;
  const chatData = database.chats_id[chatId];
  if (chatData) {
    let response = `Данные для чата ${chatId}:\n`;
    response += `Имя группы: ${chatData.name}\n`;
    response += `Категории и ID тем:\n`;
    for (const [category, threadId] of Object.entries(chatData.threads_id)) {
      response += `- ${category}: ${threadId}\n`;
    }
    bot.sendMessage(chatId, response);
  } else {
    bot.sendMessage(chatId, `Данные для чата ${chatId} не найдены.`);
  }
});

// Функция для проверки, является ли пользователь администратором
async function isAdmin(chatId, userId) {
  try {
    const chatMember = await bot.getChatMember(chatId, userId);
    return (
      chatMember.status === "administrator" || chatMember.status === "creator"
    );
  } catch (error) {
    console.error("Ошибка получения информации о пользователе:", error);
    return false;
  }
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

// Команда для удаления чата из базы данных
bot.onText(/\/delchat/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (await isAdmin(chatId, userId)) {
    if (database.chats_id[chatId]) {
      delete database.chats_id[chatId];
      saveDatabase();
      bot.sendMessage(chatId, `Чат ${chatId} удален из базы данных.`);
    } else {
      bot.sendMessage(chatId, `Чат ${chatId} не найден в базе данных.`);
    }
  } else {
    bot.sendMessage(chatId, `У вас нет прав для выполнения этой команды.`);
  }
});

// Функция для перезапуска update.js
function restartUpdateScript() {
  return new Promise((resolve, reject) => {
    exec('node update.js', (error, stdout, stderr) => {
      if (error) {
        console.error(`Ошибка перезапуска update.js: ${error.message}`);
        return reject(error);
      }
      if (stderr) {
        console.error(`Ошибка перезапуска update.js: ${stderr}`);
        return reject(new Error(stderr));
      }
      console.log(`Перезапуск update.js завершен:\n${stdout}`);
      resolve(stdout);
    });
  });
}

// Команда для перезапуска update.js
bot.onText(/\/reload/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (await isAdmin(chatId, userId)) {
    try {
      await restartUpdateScript();
      bot.sendMessage(chatId, "Скрипт update.js успешно перезапущен.");
    } catch (error) {
      bot.sendMessage(chatId, `Ошибка перезапуска скрипта: ${error.message}`);
    }
  } else {
    bot.sendMessage(chatId, `У вас нет прав для выполнения этой команды.`);
  }
});

// Основная логика для артикулов
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text || "";
  const senderId = msg.from.id;

  // Проверяем, есть ли артикулы в сообщении
  // Проверяем, является ли сообщение личным
  if (msg.chat.type === "private") {
    bot.sendMessage(
      chatId,
      `Привет! Этот бот работает только в группах. Пожалуйста, добавьте меня в группу и предоставьте права администратора.`
    );
    return;
  }

  const articleMatches = messageText.match(/\b\d{5,}\b/g); // Ищем все числа от 5 и более цифр

  if (articleMatches && articleMatches.length > 0) {
    if (isProcessing) {
      // Отправляем сообщение об очереди
      bot
        .sendMessage(chatId, "Ваш запрос добавлен в очередь, ожидайте.")
        .then((queueMessage) => {
          // Добавляем сообщение в очередь с информацией о сообщении об очереди и message_id сообщения пользователя
          messageQueue.push({
            chatId,
            articleMatches,
            senderId,
            queueMessageId: queueMessage.message_id,
            userMessageId: msg.message_id,
          });
          processQueue();
        });
    } else {
      // Если очередь пуста, сразу обрабатываем
      messageQueue.push({
        chatId,
        articleMatches,
        senderId,
        userMessageId: msg.message_id,
      });
      processQueue();
    }
  }
});

// Функция для обработки очереди
async function processQueue() {
  if (isProcessing || messageQueue.length === 0) {
    return; // Если уже идет процесс обработки или очередь пуста
  }

  isProcessing = true;
  const { chatId, articleMatches, senderId, queueMessageId, userMessageId } =
    messageQueue.shift(); // Извлекаем первый элемент из очереди

  // Удаляем сообщение "Ваш запрос добавлен в очередь", если оно было
  if (queueMessageId) {
    try {
      await bot.deleteMessage(chatId, queueMessageId);
    } catch (error) {
      console.error("Ошибка удаления сообщения об очереди:", error);
    }
  }

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
        {
          chat_id: chatId,
          message_id: progressMessage.message_id,
        }
      );
    } catch (error) {
      console.error(`Ошибка обработки артикулов ${article}:`, error);
    }
  }

  // Удаляем сообщение о прогрессе, когда все статьи обработаны
  await bot.deleteMessage(chatId, progressMessage.message_id);
}

// Обрабатываем один артикул
async function processArticle(chatId, article, senderId) {
  // Обработать артикул (проверка на наличие данных, и т.д.)
  console.log(`Обрабатывается артикул ${article} для чата ${chatId}`);

  // Получить данные и отправить сообщение (пример)
  const data = await GetCard(article);

  if (data) {
    const priceData = data.priceHistory || [];
    const formattedData = priceData.map((price) => {
      const rubles = Math.floor(price);
      const kopecks = Math.round((price - rubles) * 100);
      return `${rubles},${kopecks.toString().padStart(2, '0')}`;
    });

    bot.sendMessage(
      chatId,
      `Артикул: ${article}\nИстория цен:\n${formattedData.join("\n")}`
    );
  } else {
    bot.sendMessage(chatId, `Нет данных для артикула ${article}.`);
  }
}

// Загрузка базы данных и запуск бота
loadDatabase();
