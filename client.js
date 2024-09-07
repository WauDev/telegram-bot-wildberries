const https = require('https');
const fs = require('fs');
const path = require('path');
const { GetCard, dataEmitter } = require('./server.js');

// Версия клиента
const VERSION = "1.2.1 07.09.2024";

// Флаг автообновления
const AUTO_UPDATE = true;

// URL для проверки актуальной версии client.js
const clientUrl = 'https://raw.githubusercontent.com/WauDev/telegram-bot-wildberries/main/client.js';

// Очередь сообщений для обработки
const messageQueue = [];
let isProcessing = false;
let isUpdating = false; // Флаг для проверки обновления

// Если включен автоапдейт
if (AUTO_UPDATE) {
  // Функция для получения версии клиента с GitHub
  function checkForUpdates() {
    https.get(clientUrl, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        const remoteVersion = data.match(/const VERSION = "(.*?)"/)[1];

        if (remoteVersion !== VERSION) {
          console.log("Доступна новая версия. Запуск обновления...");
          isUpdating = true;
          bot.sendMessage(chatId, "Производится обновление, повторите позже.");

          // Дожидаемся завершения обработки очереди и останавливаем процесс
          const interval = setInterval(() => {
            if (messageQueue.length === 0 && !isProcessing) {
              console.log("Обновление завершено. Завершаем работу.");
              clearInterval(interval);
              process.exit(0); // Остановка процесса node.js для обновления
            }
          }, 1000); // Проверяем каждые 1 секунду
        }
      });
    }).on('error', (err) => {
      console.error("Ошибка при проверке обновлений:", err.message);
    });
  }

  // Проверка на обновления каждую минуту
  setInterval(checkForUpdates, 60 * 1000);
}

// Импортируем и запускаем бота только если не идет обновление
if (!AUTO_UPDATE || !isUpdating) {
  const TelegramBot = require('node-telegram-bot-api');

  // Получаем токен из переменной окружения
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const databaseFilePath = path.join(__dirname, "database.json");

  // Создаем экземпляр бота
  const bot = new TelegramBot(token, { polling: true });

  // Проверяем, что токен присутствует
  if (!token) {
    console.error("Токен не найден в переменных окружения!");
    process.exit(1);
  } else {
    console.log("Бот успешно запущен!");
  }

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

  // Основная логика для артикулов
  bot.on("message", (msg) => {
    const chatId = msg.chat.id;
    const messageText = msg.text || "";
    const senderId = msg.from.id;

    if (isUpdating) {
      bot.sendMessage(chatId, "Производится обновление, повторите позже.");
      return;
    }

    // Проверяем, есть ли артикулы в сообщении
    const articleMatches = messageText.match(/\b\d{5,}\b/g); // Ищем все числа от 5 и более цифр

    if (articleMatches && articleMatches.length > 0) {
      if (isProcessing) {
        bot
          .sendMessage(chatId, "Ваш запрос добавлен в очередь, ожидайте.")
          .then((queueMessage) => {
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
      return;
    }

    isProcessing = true;
    const { chatId, articleMatches, senderId, queueMessageId, userMessageId } =
      messageQueue.shift();

    if (queueMessageId) {
      try {
        await bot.deleteMessage(chatId, queueMessageId);
      } catch (error) {
        console.error("Ошибка удаления сообщения об очереди:", error);
      }
    }

    try {
      await processArticles(chatId, articleMatches, senderId);
    } catch (error) {
      console.error("Ошибка обработки очереди:", error);
    }

    isProcessing = false;
    processQueue();
  }

  // Функция для обработки всех артикулов в сообщении
  async function processArticles(chatId, articles, senderId) {
    const totalArticles = articles.length;
    let completedArticles = 0;

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
          `Произошла ошибка при обработке артикула ${article}`
        );
      }
    }

    await bot.sendMessage(
      chatId,
      `Обработка завершена. Всего обработано артикулов: ${totalArticles}`
    );
  }

  // Обработка конкретного артикула (эту функцию нужно реализовать в server.js)
  async function processArticle(chatId, article, senderId) {
    // Здесь вы реализуете логику обработки артикула
    await GetCard(article, chatId, senderId);
  }

  // Инициализация базы данных
  loadDatabase();
}
