// server.js
const https = require("https");
const EventEmitter = require("events");
class DataEmitter extends EventEmitter {}
const dataEmitter = new DataEmitter();

// Флаги для включения/отключения вывода
const ENABLE_JSON_OUTPUT = false;
const ENABLE_URL_OUTPUT = true;

const ServerBaseUrls = Array.from(
  { length: 18 },
  (_, i) => `https://basket-${String(i + 1).padStart(2, "0")}.wbbasket.ru/`
);

function createUrls(article) {
  const vol_Id0 = article.slice(0, 2);
  const part_Id0 = article.slice(0, 4);
  const vol_Id1 = article.slice(0, 3);
  const part_Id1 = article.slice(0, 5);
  const vol_Id2 = article.slice(0, 4);
  const part_Id2 = article.slice(0, 6);

  return ServerBaseUrls.flatMap((baseUrl, index) => [
    {
      server: String(index + 1).padStart(2, "0"),
      variant: 1,
      url: `${baseUrl}vol${vol_Id0}/part${part_Id0}/${article}/info/ru/card.json`,
      vol: vol_Id0,
      part: part_Id0,
    },
    {
      server: String(index + 1).padStart(2, "0"),
      variant: 2,
      url: `${baseUrl}vol${vol_Id1}/part${part_Id1}/${article}/info/ru/card.json`,
      vol: vol_Id1,
      part: part_Id1,
    },
    {
      server: String(index + 1).padStart(2, "0"),
      variant: 3,
      url: `${baseUrl}vol${vol_Id2}/part${part_Id2}/${article}/info/ru/card.json`,
      vol: vol_Id2,
      part: part_Id2,
    },
  ]);
}

function checkUrl({ url, server, variant }) {
  return new Promise((resolve) => {
    https
      .get(url, (res) => {
        let data = "";
        if (ENABLE_URL_OUTPUT) {
          console.log(
            `Сервер ${server} | Вариант ${variant}: ${url} Статус ответа: ${res.statusCode}`
          );
        }
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              const jsonData = JSON.parse(data);
              resolve({ url, server, variant, data: jsonData });
            } catch (e) {
              console.error(`Ошибка парсинга JSON с ${url}: ${e.message}`);
              resolve({ url, server, variant, data: null });
            }
          } else {
            resolve({ url, server, variant, data: null });
          }
        });
      })
      .on("error", (e) => {
        console.error(`Ошибка запроса: ${e.message}`);
        resolve({ url, server, variant, data: null });
      });
  });
}

function getAdditionalData(article) {
  const url = `https://card.wb.ru/cards/v2/detail?dest=0&nm=${article}`;
  return new Promise((resolve) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              const jsonData = JSON.parse(data);
              resolve(jsonData);
            } catch (e) {
              console.error(`Ошибка парсинга JSON с ${url}: ${e.message}`);
              resolve(null);
            }
          } else {
            resolve(null);
          }
        });
      })
      .on("error", (e) => {
        console.error(`Ошибка запроса: ${e.message}`);
        resolve(null);
      });
  });
}

async function GetCard(article) {
  const urls = createUrls(article);

  for (const urlInfo of urls) {
    const result = await checkUrl(urlInfo);
    if (result.data) {
      // Сохраняем данные в глобальные переменные
      global.imt_name = result.data.imt_name;
      global.subj_name = result.data.subj_name;
      global.subj_root_name = result.data.subj_root_name;

      global.server = urlInfo.server;
      global.vol = urlInfo.vol;
      global.part = urlInfo.part;

      if (ENABLE_JSON_OUTPUT) {
        console.log(
          `Сервер ${result.server} | Вариант ${result.variant}: Полный JSON ответ с ${result.url}:`
        );
        console.log(result.data);
      } else {
        console.log(
          `Сервер ${result.server} | Вариант ${result.variant}: Ссылка ${result.url} вернула успешный ответ.`
        );
      }

      const additionalData = await getAdditionalData(article);
      if (
        additionalData &&
        additionalData.data &&
        additionalData.data.products &&
        additionalData.data.products.length > 0
      ) {
        const product = additionalData.data.products[0];

        global.brand = product.brand;
        global.brandId = product.brandId;
        global.supplier = product.supplier;
        global.supplierId = product.supplierId;

        if (ENABLE_JSON_OUTPUT) {
          console.log("Информация о продуктах из второго API:");
          console.log(`Brand: ${global.brand}`);
          console.log(`Brand ID: ${global.brandId}`);
          console.log(`Supplier: ${global.supplier}`);
          console.log(`Supplier ID: ${global.supplierId}`);
        }

        global.Image_Link = `https://basket-${global.server}.wbbasket.ru/vol${global.vol}/part${global.part}/${article}/images/big/1.jpg`;
        console.log(`Image Link (JPG): ${global.Image_Link}`);

        const alternateImageLink = `https://basket-${global.server}.wbbasket.ru/vol${global.vol}/part${global.part}/${article}/images/big/1.webp`;
        console.log(`Image Link (WEBP): ${alternateImageLink}`);
      } else {
        console.log("Не удалось получить данные о продуктах из второго API.");
      }

      // Эмитируем событие с данными
      dataEmitter.emit("dataReady", {
        imt_name: global.imt_name,
        subj_name: global.subj_name,
        subj_root_name: global.subj_root_name,
        brand: global.brand,
        brandId: global.brandId,
        supplier: global.supplier,
        supplierId: global.supplierId,
        Image_Link: global.Image_Link,
      });

      return; // Остановиться на первой успешной ссылке
    }
  }
  console.log("Ни одна из ссылок не вернула успешный ответ.");
  dataEmitter.emit("dataReady", {
    article: global.error_article,
  });
  module.exports = { GetCard, dataEmitter };
}

// Экспортируем эмиттер
module.exports = { GetCard, dataEmitter };
