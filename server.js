// Multi-Server Discord-Roblox Bridge
const express = require('express');
const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');
require('dotenv').config();

const app = express();
app.use(express.json());

// Store messages per server
const serverMessages = new Map(); // serverId -> array of messages
const serverChannels = new Map(); // serverId -> Discord channel ID
const MAX_MESSAGES = 50;

// Configuration
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID; // Your Discord server ID
const DISCORD_CATEGORY_ID = process.env.DISCORD_CATEGORY_ID; // Optional: category to create channels in
const DISCORD_ALLOWED_ROLE_ID = process.env.DISCORD_ALLOWED_ROLE_ID; // Optional: Role ID that can see channels
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

// Function to create or get Discord channel for a Roblox server
async function getOrCreateChannel(serverId) {
    // Check if we already have a channel for this server
    if (serverChannels.has(serverId)) {
        const channelId = serverChannels.get(serverId);
        try {
            const channel = await discordClient.channels.fetch(channelId);
            return channel;
        } catch (error) {
            // Channel was deleted, remove from map
            serverChannels.delete(serverId);
        }
    }

    // Create new channel
    try {
        const guild = await discordClient.guilds.fetch(DISCORD_GUILD_ID);
        const shortId = serverId.substring(0, 8);
        
        const channelOptions = {
            name: `roblox-${shortId}`,
            type: ChannelType.GuildText,
            topic: `Roblox Server ID: ${serverId}`,
            permissionOverwrites: [
                {
                    // Deny @everyone from seeing the channel
                    id: guild.roles.everyone.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                }
            ]
        };

        // If a specific role is specified, allow them to see it
        if (DISCORD_ALLOWED_ROLE_ID) {
            channelOptions.permissionOverwrites.push({
                id: DISCORD_ALLOWED_ROLE_ID,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory
                ]
            });
        }

        // Add to category if specified
        if (DISCORD_CATEGORY_ID) {
            channelOptions.parent = DISCORD_CATEGORY_ID;
        }

        const channel = await guild.channels.create(channelOptions);
        
        // Store the mapping
        serverChannels.set(serverId, channel.id);
        
        // Send welcome message
        await channel.send(`🎮 **Roblox Server Connected!**\nServer ID: \`${serverId}\`\nMessages from this Roblox server will appear here.`);
        
        console.log(`✅ Created Discord channel for server ${shortId}`);
        return channel;
    } catch (error) {
        console.error('Error creating channel:', error);
        throw error;
    }
}

// Listen for Discord messages
discordClient.on('messageCreate', async (message) => {
    // Ignore bot messages
    if (message.author.bot) return;
    
    // Find which Roblox server this channel is linked to
    let serverId = null;
    for (const [sid, channelId] of serverChannels.entries()) {
        if (channelId === message.channel.id) {
            serverId = sid;
            break;
        }
    }
    
    if (!serverId) return; // Not a linked channel
    
    // Store message for this server
    if (!serverMessages.has(serverId)) {
        serverMessages.set(serverId, []);
    }
    
    const messages = serverMessages.get(serverId);
    const msgData = {
        id: message.id,
        username: message.author.username,
        content: message.content,
        timestamp: Date.now()
    };
    
    messages.push(msgData);
    
    // Keep only recent messages
    if (messages.length > MAX_MESSAGES) {
        messages.shift();
    }
    
    console.log(`📩 Discord message in server ${serverId.substring(0, 8)} from ${message.author.username}: ${message.content}`);
});

// Login to Discord
discordClient.login(DISCORD_BOT_TOKEN);

// Register a new Roblox server
app.post('/register-server', async (req, res) => {
    const { serverId } = req.body;
    
    if (!serverId) {
        return res.status(400).json({ error: 'Missing serverId' });
    }
    
    try {
        const channel = await getOrCreateChannel(serverId);
        res.json({ 
            success: true, 
            channelId: channel.id,
            channelName: channel.name
        });
    } catch (error) {
        console.error('Error registering server:', error);
        res.status(500).json({ error: 'Failed to create channel' });
    }
});

// Get messages for a specific Roblox server
app.get('/messages', (req, res) => {
    const { serverId, last } = req.query;
    
    if (!serverId) {
        return res.status(400).json({ error: 'Missing serverId' });
    }
    
    const messages = serverMessages.get(serverId) || [];
    let messagesToSend = messages;
    
    if (last) {
        const lastIndex = messages.findIndex(msg => msg.id === last);
        if (lastIndex !== -1) {
            messagesToSend = messages.slice(lastIndex + 1);
        }
    }
    
    res.json({
        messages: messagesToSend,
        count: messagesToSend.length
    });
});

// Send message from Roblox to Discord
app.post('/send', async (req, res) => {
    const { serverId, username, message, userId } = req.body;
    
    if (!serverId || !username || !message) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    try {
        const channel = await getOrCreateChannel(serverId);
        const avatarUrl = userId ? `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=150&height=150` : null;
        
        let messageContent = `**${username}** (Roblox): ${message}`;
        
        await channel.send(messageContent);
        
        console.log(`📤 Sent to Discord from ${username} in server ${serverId.substring(0, 8)}: ${message}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error sending to Discord:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Unregister a Roblox server (delete channel)
app.post('/unregister-server', async (req, res) => {
    const { serverId } = req.body;
    
    if (!serverId) {
        return res.status(400).json({ error: 'Missing serverId' });
    }
    
    try {
        const channelId = serverChannels.get(serverId);
        if (channelId) {
            const channel = await discordClient.channels.fetch(channelId);
            await channel.delete('Roblox server closed');
            
            // Remove from active servers
            serverChannels.delete(serverId);
            serverMessages.delete(serverId);
            
            console.log(`🗑️ Deleted channel for server ${serverId.substring(0, 8)}`);
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting channel:', error);
        res.status(500).json({ error: 'Failed to delete channel' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'online',
        discord: discordClient.isReady() ? 'connected' : 'disconnected',
        activeServers: serverChannels.size,
        totalMessages: Array.from(serverMessages.values()).reduce((sum, arr) => sum + arr.length, 0)
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 Multi-server bridge active`);
});
