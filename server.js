// Discord-Roblox Bridge Server
// Install dependencies: npm install express discord.js dotenv
const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();
const app = express();
app.use(express.json());
// Store recent messages (in memory - resets on restart)
let recentMessages = [];
const MAX_MESSAGES = 50;
// Configuration
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const PORT = process.env.PORT || 3000;
// Create Discord bot
const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});
// When bot is ready
discordClient.once('ready', () => {
    console.log(`✅ Discord bot logged in as ${discordClient.user.tag}`);
});
// Listen for Discord messages
discordClient.on('messageCreate', async (message) => {
    // Ignore bot messages and only listen to specific channel
    if (message.author.bot || message.channel.id !== DISCORD_CHANNEL_ID) return;
    
    // Store message
    const msgData = {
        id: message.id,
        username: message.author.username,
        content: message.content,
        timestamp: Date.now()
    };
    
    recentMessages.push(msgData);
    
    // Keep only recent messages
    if (recentMessages.length > MAX_MESSAGES) {
        recentMessages.shift();
    }
    
    console.log(`📩 Discord message from ${message.author.username}: ${message.content}`);
});
// Login to Discord
discordClient.login(DISCORD_BOT_TOKEN);
// API endpoint for Roblox to fetch Discord messages
app.get('/messages', (req, res) => {
    const lastId = req.query.last;
    
    // Get messages after the last ID
    let messagesToSend = recentMessages;
    if (lastId) {
        const lastIndex = recentMessages.findIndex(msg => msg.id === lastId);
        if (lastIndex !== -1) {
            messagesToSend = recentMessages.slice(lastIndex + 1);
        }
    }
    
    res.json({
        messages: messagesToSend,
        count: messagesToSend.length
    });
});
// API endpoint for Roblox to send messages to Discord
app.post('/send', async (req, res) => {
    const { username, message } = req.body;
    
    if (!username || !message) {
        return res.status(400).json({ error: 'Missing username or message' });
    }
    
    try {
        const channel = await discordClient.channels.fetch(DISCORD_CHANNEL_ID);
        await channel.send(`**${username}** (Roblox): ${message}`);
        
        console.log(`📤 Sent to Discord from ${username}: ${message}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error sending to Discord:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});
// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'online',
        discord: discordClient.isReady() ? 'connected' : 'disconnected',
        messagesInMemory: recentMessages.length
    });
});
// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 Endpoints:`);
    console.log(`   GET  /messages - Fetch Discord messages`);
    console.log(`   POST /send - Send message to Discord`);
    console.log(`   GET  /health - Check server status`);
});
