const VERSION = "1.4.1"; // Старая версия
const NEW_VERSION_URL = "https://raw.githubusercontent.com/WauDev/telegram-bot-wildberries/main/client.js.temp"; // URL для проверки обновлений
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');
const { GetCard, dataEmitter } = require('./server.js');

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
let isUpdateDetected = false; // Флаг обновления

// Функция для загрузки кода и получения новой версии
function checkForUpdates() {
  https.get(NEW_VERSION_URL, (res) => {
    let data = '';

    res.on('data', chunk => {
      data += chunk;
    });

    res.on('end', () => {
      const versionMatch = data.match(/const VERSION = "([\d.]+)"/);
      if (versionMatch) {
        const NEW_VERSION = versionMatch[1];
        console.log(`Текущая версия: ${VERSION}, Новая версия: ${NEW_VERSION}`);

        if (NEW_VERSION > VERSION) {
          isUpdateDetected = true;
          notifyUpdate(NEW_VERSION);
        }
      }
    });
  }).on('error', (err) => {
    console.error('Ошибка при загрузке новой версии:', err.message);
  });
}

// Функция для уведомления об обновлении
function notifyUpdate(newVersion) {
  // Уведомляем во всех чатах
  for (const chatId of Object.keys(database.chats_id)) {
    bot.sendMessage(chatId, `Доступна новая версия: ${newVersion}. Бот завершит работу для обновления.`);
  }

  // Останавливаем прием новых сообщений
  bot.removeTextListener(/./);
  
  // Дожидаемся завершения всех задач в очереди
  processQueue(() => {
    console.log('Очередь завершена, бот завершает работу для обновления.');
    // ТУТ МЕНЯТЬ
    exec("kill -s SIGHUP $(ps -ef | grep update | awk 'NR==1 {print $2}')", (error, stdout, stderr) => {
      if (error) {
        console.error(`Ошибка завершения процесса: ${error.message}`);
      } else {
        console.log('Процесс обновления завершён.');
      }

      // Запускаем update.js
      exec('node update.js', (err, stdout, stderr) => {
        if (err) {
          console.error(`Ошибка запуска update.js: ${err.message}`);
        } else {
          console.log('update.js успешно запущен.');
        }
      });
    });
  });
}

// Функция для обработки очереди
async function processQueue(callback) {
  if (isProcessing || messageQueue.length === 0) {
    if (callback) callback();
    return;
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
  processQueue(callback); // Продолжаем обработку следующего сообщения в очереди
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
  GetCard(article);

  return new Promise((resolve, reject) => {
    dataEmitter.once('dataReady', async (data) => {
      try {
        if (data.error_article) {
          await bot.sendMessage(chatId, `Ошибка, данные для артикула ${article} не были получены.`);
          return reject(new Error(`Ошибка данных для артикула ${article}`));
        }

        // Получаем информацию о пользователе
        let userLink = `@id${senderId}`; // Значение по умолчанию
        try {
          const userInfo = await bot.getChatMember(chatId, senderId);
          const user = userInfo.user;
          if (user.username) {
            userLink = `<a href="https://t.me/${user.username}">${user.first_name}</a>`;
          } else if (user.first_name) {
            userLink = `<a href="https://t.me/${senderId}">${user.first_name}</a>`;
          } else {
            userLink = `<a href="https://t.me/${senderId}">User ${senderId}</a>`;
          }
        } catch (error) {
          console.error('Ошибка получения информации о пользователе:', error);
        }

        const formattedSubjName = data.subj_root_name ? data.subj_root_name.replace(/ /g, '_') : 'Неизвестная_подкатегория';
        const formattedsubjName = data.subj_name ? data.subj_name.replace(/ /g, '_') : 'Неизвестная_подкатегория';

        // Получаем цены и сортируем их по убыванию
        const prices = data.prices;
        const sortedPrices = Object.keys(prices)
          .sort((a, b) => parseInt(b.match(/\d+/)) - parseInt(a.match(/\d+/))) // Сортируем по номеру в ключе priceN
          .map(key => prices[key]); // Извлекаем значения цен

        const pricesText = sortedPrices.join('\n');

        const caption = `<a href="https://www.wildberries.ru/catalog/${article}/detail.aspx?targetUrl=SG">${data.imt_name || 'Без названия'}</a>\n\n` +
                        `Категория: #${formattedsubjName}\n` +
                        `Подкатегория: #${formattedSubjName}\n\n` +
                        `Артикул: <code>${article}</code>\n` +
                        `Отправитель: ${userLink}\n\n` +
                        `Предыдущие цены :\n${pricesText}`;

        // Ищем данные по категории в базе данных
        const chatData = database.chats_id[chatId];
        if (chatData) {
          const threadId = chatData.threads_id[data.subj_name];
          if (threadId) {
            await bot.sendPhoto(chatId, data.Image_Link, {
              caption: caption,
              message_thread_id: threadId,
              parse_mode: 'HTML'
            });
          } else {
            if (!chatData.threads_id.hasOwnProperty(data.subj_name)) {
              try {
                if (data.subj_name && data.subj_name.trim() !== '') {
                  const forumTopic = await bot.createForumTopic(chatId, data.subj_name);
                  const newThreadId = forumTopic.message_thread_id;
                  chatData.threads_id[data.subj_name] = newThreadId;
                  saveDatabase();
                  await bot.sendPhoto(chatId, data.Image_Link, {
                    caption: caption,
                    message_thread_id: newThreadId,
                    parse_mode: 'HTML'
                  });
                } else {
                  await bot.sendMessage(chatId, `Ошибка, данные для артикула ${article} не были получены.`);
                }
              } catch (error) {
                console.error('Ошибка создания топика:', error);
                await bot.sendMessage(chatId, 'Не удалось создать новый топик для категории.');
              }
            }
          }
        } else {
          await bot.sendMessage(chatId, `Чат ${chatId} не найден в базе данных.`);
        }

        resolve();
      } catch (error) {
        console.error('Ошибка обработки данных:', error);
        reject(error);
      }
    });

    dataEmitter.once('error', async (error) => {
      await bot.sendMessage(chatId, `Ошибка при получении данных: ${error.message}`);
      reject(error);
    });
  });
}


// Инициализация базы данных 
loadDatabase();

// Запускаем проверку на обновления каждую минуту 
setInterval(checkForUpdates, 60 * 1000);

