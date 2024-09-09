const VERSION = "1.2.8";
console.log("Текущая версия: " + VERSION)
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const https = require('https'); // Для загрузки файла по URL
const { GetCard, dataEmitter } = require('./server.js');
const { exec } = require('child_process');

// Получаем токен из переменной окружения
const token = process.env.TELEGRAM_BOT_TOKEN;
const databaseFilePath = path.join(__dirname, 'database.json');
const NEW_VERSION_URL = 'https://raw.githubusercontent.com/WauDev/telegram-bot-wildberries/main/client.js';

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

// Получение информации о дисковом пространстве
const getDiskSpace = (need_disk = '') =>
  new Promise((resolve, reject) => {
    exec('df -h', (err, stdout, stderr) => {
      if (err || stderr) return reject(`Ошибка: ${err || stderr}`);
      
      const lines = stdout.trim().split('\n');
      const headers = lines[0].split(/\s+/);
      const result = need_disk ? '' : `${headers.join(' ')}\n${lines.slice(1).join('\n')}`;
      const diskInfo = lines.slice(1).reduce((info, line) => {
        const [filesystem, size, used, , usePercent, ] = line.split(/\s+/);
        if (filesystem === need_disk) {
          return { UsageDiskPercentage: usePercent, Disk: size, UsageDiskMB: used };
        }
        return info;
      }, null);
      
      resolve({ result, diskInfo });
    });
  });

// Получение информации о памяти и процессоре
const getSystemInfo = () => {
  const memoryUsage = parseInt(fs.readFileSync("/sys/fs/cgroup/memory/memory.soft_limit_in_bytes", 'utf8').trim(), 10) / 1024 / 1024;
  const totalRss = fs.readFileSync("/sys/fs/cgroup/memory/memory.stat", "utf8")
    .split("\n")
    .filter(line => line.startsWith("total_rss"))[0]
    .split(" ")[1];
  const ramPercent = Math.round((totalRss / 536870912) * 1000) / 30;
  
  return {
    MemoryUsagePercentage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    RAMUsageMB: Math.round(ramPercent),
    MemoryUsage: memoryUsage,
    CPUUsagePercentage: Math.round(process.cpuUsage().system) / 1000
  };
}

// Основная функция
const GetInfo = async (chatId, need_disk) => {
  try {
    const { result, diskInfo } = await getDiskSpace(need_disk);

    let message = '';
    if (need_disk === '') {
      message = 'Найдите свой диск:\n' + result.trim();
    } else if (diskInfo) {
      const systemInfo = getSystemInfo();
      message = `RAM: ${systemInfo.MemoryUsagePercentage}%    ${systemInfo.RAMUsageMB}MB / ${systemInfo.MemoryUsage}MB\n` +
                `ROM: ${diskInfo.UsageDiskPercentage}  ${diskInfo.UsageDiskMB}B / ${diskInfo.Disk}B\n` +
                `CPU: ${systemInfo.CPUUsagePercentage}%`;
    } else {
      message = 'Диск не найден.';
    }
    await bot.sendMessage(chatId, message);
  } catch (error) {
    console.error(error);
    await bot.sendMessage(chatId, `Ошибка получения информации: ${error}`);
  }
};

// Команда для получения информации о системе
bot.onText(/\/getinfo(?:\s+(\/dev\/\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const need_disk = match[1] || ''; // Получаем путь к диску из команды, если он указан

  await GetInfo(chatId, need_disk);
});

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

//
// Команда для получения текущей версии 
bot.onText(/\/version/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  
      bot.sendMessage(chatId, `Текущая версия: ` + VERSION);
    
});
//





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

  // Удаляем сообщение "Ваш запрос добавлен в очереди", если оно было
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
                        `Предыдущие цены:\n${pricesText}`;

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
                  const forumTopic = await bot.createForumTopic(chatId, data.subj_name, {
                    is_closed: false,
                    is_hidden: false
                  });
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

// Функция для проверки и загрузки новой версии
async function checkForUpdates() {
  https.get(NEW_VERSION_URL, (response) => {
    let data = '';

    response.on('data', (chunk) => {
      data += chunk;
    });

    response.on('end', async () => {
      try {
        const newVersionMatch = data.match(/const VERSION = "([^"]+)"/);
        if (newVersionMatch) {
          const NEW_VERSION = newVersionMatch[1];
          
          if (NEW_VERSION > VERSION) {
            // Пишем в чат об обновлении
            for (const chatId in database.chats_id) {
              console.log('Обновление доступно! Новая версия: ' + NEW_VERSION)
              await bot.sendMessage(chatId, `Обновление доступно!/n Новая версия: ${NEW_VERSION}/n Перезагрузка сервера!`);
            }
            
            // Прекращаем принимать заказы в очередь
            const oldQueue = messageQueue.slice(); // Копируем очередь для дальнейшей обработки
            messageQueue.length = 0; // Очищаем текущую очередь
            
            // Дожидаемся выполнения всей очереди до последней отправки
            for (const item of oldQueue) {
              await processQueue();
            }
            
            // Перезапускаем update
            const updateProcessId = await getUpdateProcessId();
            if (updateProcessId) {
              process.kill(updateProcessId, 'SIGHUP');
            }
          }
        }
      } catch (error) {
        console.error('Ошибка обработки новой версии:', error);
      }
    });
  }).on('error', (error) => {
    console.error('Ошибка загрузки новой версии:', error);
  });
}

// Функция для получения идентификатора процесса update
async function getUpdateProcessId() {
  return new Promise((resolve, reject) => {
    require('child_process').exec("ps -ef | grep 'update' | awk 'NR==1 {print $2}'", (error, stdout) => {
      if (error) {
        return reject(error);
      }
      resolve(parseInt(stdout.trim(), 10));
    });
  });
}

// Запускаем проверку обновлений каждую минуту
setInterval(checkForUpdates, 10 * 1000);


// Инициализация базы данных
loadDatabase();

