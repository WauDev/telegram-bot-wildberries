const VERSION = '1.3.1 07.09.2024';
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const { GetCard, dataEmitter } = require('./server.js');

// URL для проверки новой версии
const NEW_VERSION_URL = 'https://raw.githubusercontent.com/WauDev/telegram-bot-wildberries/main/client.js';

// Получаем токен из переменной окружения
const token = process.env.TELEGRAM_BOT_TOKEN;
const databaseFilePath = path.join(__dirname, 'database.json');

// Создаем экземпляр бота
const bot = new TelegramBot(token, { polling: true });

// Проверяем, что токен присутствует
if (!token) {
  console.error('Токен не найден в переменных окружения!');
  process.exit(1);
} else {
  console.log("Бот успешно запущен!");
}

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
    return chatMember.status === 'administrator' || chatMember.status === 'creator';
  } catch (error) {
    console.error('Ошибка получения информации о пользователе:', error);
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
  if (msg.chat.type === 'private') {
    bot.sendMessage(chatId, `Привет! Этот бот работает только в группах. Пожалуйста, добавьте меня в группу и предоставьте права администратора.`);
    return;
  }
  
  const articleMatches = messageText.match(/\b\d{5,}\b/g); // Ищем все числа от 5 и более цифр

  if (articleMatches && articleMatches.length > 0) {
    if (isProcessing) {
      // Отправляем сообщение об очереди
      bot.sendMessage(chatId, "Ваш запрос добавлен в очередь, ожидайте.").then((queueMessage) => {
        messageQueue.push({ chatId, articleMatches, senderId, queueMessageId: queueMessage.message_id, userMessageId: msg.message_id });
        processQueue();
      });
    } else {
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

  if (queueMessageId) {
    try {
      await bot.deleteMessage(chatId, queueMessageId);
    } catch (error) {
      console.error('Ошибка удаления сообщения об очереди:', error);
    }
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

  let progressMessage = await bot.sendMessage(chatId, `Выполняется: ${articles[0]}\n\nВыполнено 0%\nОсталось ${totalArticles - completedArticles} из ${totalArticles}`);

  for (const article of articles) {
    try {
      await processArticle(chatId, article, senderId);
      completedArticles++;

      const percentComplete = Math.floor((completedArticles / totalArticles) * 100);
      await bot.editMessageText(
        `Выполняется: ${article}\n\nВыполнено ${percentComplete}%\nОсталось ${totalArticles - completedArticles} из ${totalArticles}`, 
        { chat_id: chatId, message_id: progressMessage.message_id }
      );
    } catch (error) {
      console.error(`Ошибка обработки артикула ${article}:`, error);
      await bot.sendMessage(chatId, `Ошибка, данные для артикула ${article} не были получены.`);
      break;
    }
  }

  await bot.deleteMessage(chatId, progressMessage.message_id);
}

// Функция для обработки одного артикула
async function processArticle(chatId, article, senderId) {
  GetCard(article);

  return new Promise((resolve, reject) => {
    dataEmitter.once('dataReady', async (data) => {
      try {
        if (data.error_article) {
          await bot.sendMessage(chatId, `Ошибка, данные для артикула ${article} не были получены.`);
          return reject(new Error(`Ошибка данных для артикула ${article}`));
        }

        const formattedSubjName = data.subj_root_name ? data.subj_root_name.replace(/ /g, '_') : 'Неизвестная_подкатегория';
        const formattedsubjName = data.subj_name ? data.subj_name.replace(/ /g, '_') : 'Неизвестная_подкатегория';

        const prices = data.prices;
        const sortedPrices = Object.keys(prices)
          .sort((a, b) => parseInt(b.match(/\d+/)) - parseInt(a.match(/\d+/))) // Сортируем по номеру в ключе priceN
          .map(key => prices[key]); // Извлекаем значения цен

        const pricesText = sortedPrices.join('\n');
        const caption = `<a href="https://www.wildberries.ru/catalog/${article}/detail.aspx?targetUrl=SG">${data.imt_name || 'Без названия'}</a>\n\n` +
                        `Категория: #${formattedsubjName}\n` +
                        `Подкатегория: #${formattedSubjName}\n\n` +
                        `Цены:\n${pricesText}`;

        await bot.sendMessage(chatId, caption, { parse_mode: 'HTML' });
        resolve();
      } catch (error) {
        console.error(`Ошибка при отправке данных для артикула ${article}:`, error);
        reject(error);
      }
    });
  });
}

// Остановка принятия новых задач
function stopProcessingNewTasks() {
  bot.sendMessage(database.chats_id, 'Новые задачи не принимаются, ждем завершения текущих.');
}

// Функция ожидания завершения очереди или немедленного завершения, если задач нет
function waitForQueueToFinish() {
  return new Promise(resolve => {
    if (messageQueue.length === 0 && !isProcessing) {
      // Если нет задач в очереди и ничего не обрабатывается, завершаем сразу
      console.log('Очередь пуста, переходим к завершению процесса.');
      resolve();
    } else {
      const checkQueue = () => {
        if (!isProcessing && messageQueue.length === 0) {
          console.log('Очередь завершена, переходим к завершению процесса.');
          resolve();
        } else {
          setTimeout(checkQueue, 1000); // Проверяем каждые 1 секунду
        }
      };
      checkQueue();
    }
  });
}

// Отправка уведомления об обновлении во все чаты
function sendUpdateNotification(message) {
  Object.keys(database.chats_id).forEach(chatId => {
    bot.sendMessage(chatId, message);
  });
}

// Функция проверки обновлений с перезапуском процесса при необходимости
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
              console.log('Завершаем старый процесс и перезапускаем обновление.');
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

// Инициализация базы данных
loadDatabase();
