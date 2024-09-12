const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');
const path = require('path');

// URL для загрузки новых файлов
const clientUrl = 'https://raw.githubusercontent.com/WauDev/telegram-bot-wildberries/main/client.js';
const serverUrl = 'https://raw.githubusercontent.com/WauDev/telegram-bot-wildberries/main/server.js';

// Путь к файлам
const clientPath = path.join(__dirname, 'client.js');
const serverPath = path.join(__dirname, 'server.js');

// Функция для удаления файлов и создания новых
function resetFiles() {
    try {
        // Удалить старые файлы
        if (fs.existsSync(clientPath)) {
            fs.unlinkSync(clientPath);
        }
        if (fs.existsSync(serverPath)) {
            fs.unlinkSync(serverPath);
        }
        
        // Создать новые пустые файлы
        fs.writeFileSync(clientPath, '');
        fs.writeFileSync(serverPath, '');

        console.log('Старые файлы удалены и созданы новые пустые файлы.');
    } catch (err) {
        console.error('Ошибка при обработке файлов:', err);
    }
}

// Функция для загрузки файла по URL
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    console.log(`${dest} загружен.`);
                    resolve();
                });
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => reject(err)); // Удалить неполный файл при ошибке
            console.error(`Ошибка загрузки ${url}:`, err);
        });
    });
}

// Функция для загрузки новых файлов
async function updateFiles() {
    try {
        await downloadFile(clientUrl, clientPath);
        await downloadFile(serverUrl, serverPath);
        console.log('Файлы успешно обновлены.');
    } catch (err) {
        console.error('Ошибка при обновлении файлов:', err);
    }
}

// Функция для запуска client.js
function startClient() {
    const clientProcess = spawn('node', [clientPath], {
        stdio: 'pipe' // Для получения вывода stdout и stderr
    });

    // Обработка stdout
    clientProcess.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
    });

    // Обработка stderr
    clientProcess.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });

    clientProcess.on('close', (code) => {
        console.log(`client.js завершился с кодом: ${code}`);
    });
}

// Основная функция
async function main() {
    await resetFiles();     // Удаляем старые файлы и создаем новые
    await updateFiles(); // Загружаем новые файлы
    startClient();       // Запускаем client.js
}

// Запуск скрипта
main();


