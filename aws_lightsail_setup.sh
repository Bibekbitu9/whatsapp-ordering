#!/bin/bash

# AWS Lightsail Ubuntu Setup Script for WhatsApp Bot
# This script installs Node.js, Chromium, and PM2 automatically.

echo "🚀 Starting AWS Lightsail environment setup..."

# 1. Update system using non-interactive mode
echo "📦 Updating system packages..."
sudo DEBIAN_FRONTEND=noninteractive apt update && sudo DEBIAN_FRONTEND=noninteractive apt upgrade -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"

# 2. Install Node.js (v20 LTS recommended for modern apps)
echo "🟢 Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Install Chromium and all required shared libraries for Puppeteer (whatsapp-web.js)
echo "🌐 Installing Chromium browser and dependencies..."
sudo apt install -y chromium-browser fonts-liberation libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libc6 libcairo2 libcups2t64 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc-s1 libglib2.0-0t64 libgtk-3-0t64 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release wget xdg-utils

# 4. Install PM2 (Process Manager to keep bot running 24/7)
echo "🔄 Installing PM2..."
sudo npm install -g pm2

echo "✅ Setup Complete!"
echo "You can now git clone your repository, run 'npm install', create your '.env' file, and start the bot with 'pm2 start index.js'."
