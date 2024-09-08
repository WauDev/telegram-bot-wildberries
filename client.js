const VERSION = '1.1.1 07.09.2024';
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { GetCard, dataEmitter } = require('./server.js');
const https = require('https');

// Получаем токен из переменной окружения
const token = process.env.TELEGRAM_BOT_TOKEN;
const databaseFilePath = path.join(__dirname, 'database.json');

// Создаем экземпляр бота
const bot = new TelegramBot(token, { polling: true });

// Проверяем, что токен присутствует
if (!token) {
  console.error('Токен не найден в переменных окружения!');
  process.exit(1);
} else console.log("Бот успешно запущен!");

// Загружаем базу данных
let database = { "chats_id": {} };

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

// URL для проверки новой версии
const NEW_VERSION_URL = 'https://raw.githubusercontent.com/WauDev/telegram-bot-wildberries/main/client.js';

// Функция проверки обновлений
async function checkForUpdates() {
  try {
    https.get(NEW_VERSION_URL, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        const newVersionMatch = data.match(/const VERSION = "([^"]+)"/);
        if (newVersionMatch) {
          const NEW_VERSION = newVersionMatch[1];
          if (NEW_VERSION !== VERSION) {
            sendUpdateNotification('Обновление доступно! Бот перезагрузится после завершения текущих задач.');
            stopProcessingNewTasks();
            waitForQueueToFinish().then(() => {
              // Завершаем старый процесс
              const updateProcesses = execSync('ps -ef | grep update | awk \'NR==1 {print $2}\'').toString().trim();
              if (updateProcesses) {
                execSync(`kill -s SIGHUP ${updateProcesses}`);
              }
            });
          }
        }
      });
    });
  } catch (error) {
    console.error('Ошибка при проверке обновлений:', error);
  }
}

// Функция отправки уведомления в каждый чат
async function sendUpdateNotification(message) {
  for (const chatId of Object.keys(database.chats_id)) {
    try {
      await bot.sendMessage(chatId, message);
    } catch (error) {
      console.error(`Ошибка отправки сообщения в чат ${chatId}:`, error);
    }
  }
}

// Функция остановки принятия новых задач
function stopProcessingNewTasks() {
  console.log('Новые задачи не принимаются, ждем завершения текущих.');
  isProcessing = true;
}

// Функция ожидания завершения очереди
function waitForQueueToFinish() {
  return new Promise(resolve => {
    const checkQueue = () => {
      if (!isProcessing && messageQueue.length === 0) {
        resolve();
      } else {
        setTimeout(checkQueue, 1000); // Проверяем каждые 1 секунду
      }
    };
    checkQueue();
  });
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
      const chatName = msg.chat.title || 'Неизвестная группа';
      database.chats_id[chatId] = {
        name: chatName,
        threads_id: {}
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
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text || '';
  const senderId = msg.from.id;

  // Проверяем, есть ли артикулы в сообщении
   // Проверяем, является ли сообщение личным
  if (msg.chat.type === 'private') {
    bot.sendMessage(chatId, `Привет! Этот бот работает только в группах. Пожалуйста, добавьте меня в группу и предоставьте права администратора.`);
    return;
  }
  
  const articleMatches = messageText.match(/\b\d{5,}\b/g); // Ищем все числа от 5 и более цифр

  if (articleMatches && articleMatches.length > 0) {
    if (isProcessing) {
      // Отправляем сообщение об очереди
      bot.sendMessage(chatId, "Ваш запрос добавлен в очередь, ожидайте.").then((queueMessage) => {
        // Добавляем сообщение в очередь с информацией о сообщении об очереди и message_id сообщения пользователя
        messageQueue.push({ chatId, articleMatches, senderId, queueMessageId: queueMessage.message_id, userMessageId: msg.message_id });
        processQueue();
      });
    } else {
      // Если очередь пуста, сразу обрабатываем
      messageQueue.push({ chatId, articleMatches, senderId, userMessageId: msg.message_id });
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
  const { chatId, articleMatches, senderId, queueMessageId, userMessageId } = messageQueue.shift(); // Извлекаем первый элемент из очереди

  // Удаляем сообщение "Ваш запрос добавлен в очередь", если оно было
  if (queueMessageId) {
    try {
      await bot.deleteMessage(chatId, queueMessageId);
    } catch (error) {
      console.error('Ошибка удаления сообщения об очереди:', error);
    }
  }

  // Удаляем сообщение пользователя с артикулами
  try {
    await bot.deleteMessage(chatId, userMessageId);
  } catch (error) {
    console.error('Ошибка удаления сообщения пользователя:', error);
  }

  try {
    await processArticles(chatId, articleMatches, senderId);
  } catch (error) {
    console.error('Ошибка обработки очереди:', error);
  }

  isProcessing = false;
  processQueue(); // Продолжаем обработку следующего сообщения в очереди
}

// Функция для обработки всех артикулов в сообщении
async function processArticles(chatId, articles, senderId) {
  const totalArticles = articles.length;
  let completedArticles = 0;

  // Создаем сообщение о прогрессе
  let progressMessage = await bot.sendMessage(chatId, `Выполняется: ${articles[0]}\n\nВыполнено 0%\nОсталось ${totalArticles - completedArticles} из ${totalArticles}`);

  for (const article of articles) {
    try {
      await processArticle(chatId, article, senderId);
      completedArticles++;

      // Обновляем сообщение о прогрессе
      const percentComplete = Math.floor((completedArticles / totalArticles) * 100);
      await bot.editMessageText(
        `Выполняется: ${article}\n\nВыполнено ${percentComplete}%\nОсталось ${totalArticles - completedArticles} из ${totalArticles}`, 
        { chat_id: chatId, message_id: progressMessage.message_id }
      );
    } catch (error) {
      console.error(`Ошибка обработки артикула ${article}:`, error);
      await bot.sendMessage(chatId, `Ошибка, данные для артикула ${article} не были получены.`);
      // Прерываем обработку текущих артикулов
      break;
    }
  }

  // Удаляем сообщение, когда все артикулы обработаны или произошла ошибка
  await bot.deleteMessage(chatId, progressMessage.message_id);
}

// Функция для обработки одного артикула
async function processArticle(chatId, article, senderId) {
  return new Promise((resolve, reject) => {
    const requestData = { id: senderId, art: article };
    
    dataEmitter.once('data', (data) => {
      if (data && data.error) {
        reject(new Error(data.error));
      } else {
        bot.sendMessage(chatId, data);
        resolve();
      }
    });

    GetCard(requestData);
  });
}

// Проверяем обновления каждую минуту
setInterval(checkForUpdates, 60000);

// Загрузка базы данных при запуске
loadDatabase();
