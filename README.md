# Telegram bot wildberries

A powerful Telegram bot designed to handle article numbers and manage related data in groups. This bot processes incoming articles, updates a database, and provides real-time progress updates to users.

## Features

- **Article Processing:** Handles articles sent in messages and processes them in a queue.
- **Database Management:** Maintains a database of chats, threads, and articles.
- **Real-time Updates:** Sends progress updates and handles errors gracefully.
- **Admin Commands:** Allows admins to manage chat data with commands for adding and removing chats.

## Getting Started

To get started with the Telegram Article Bot, follow these steps:

1. **Clone the Repository**

   ```bash
   git clone https://github.com/WauDev/telegram-bot-wildberries.git```

2. **Install Dependencies**

   ```bash
   cd telegram-article-bot
   npm install```

3. **Set Up Environment Variables**
   ```bash
  "TELEGRAM_BOT_TOKEN=your-telegram-bot-token"```

4. **Run the Bot**
   ```bash
   node client.js```

## Commands

## /database - Displays database information for the current chat.
## /addchat - Adds the current chat to the database (admin only).
## /delchat - Removes the current chat from the database (admin only).
