require('dotenv').config();

const express = require('express');
const axios = require('axios');
const { WebClient } = require('@slack/web-api');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
const MONDAY_API = "https://api.monday.com/v2";

// ✅ YOUR SLACK USER ID
const YOUR_USER_ID = "U0AF5TEDC8M";

// ✅ HEALTH CHECK
app.get('/', (req, res) => {
    res.send("Server is running 🚀");
});

// 🔥 CREATE UNIQUE PRIVATE CHANNEL
async function createUniqueChannel(name) {
    let base = name.toLowerCase().replace(/\s+/g, '-');
    let channelName = base;
    let count = 1;

    while (true) {
        try {
            const result = await slack.conversations.create({
                name: channelName,
                is_private: true
            });
            return result.channel.id;
        } catch (error) {
            if (error.data?.error === "name_taken") {
                channelName = `${base}-${count}`;
                count++;
            } else {
                console.error("Channel error:", error.data || error);
                throw error;
            }
        }
    }
}

// 🔥 MONDAY WEBHOOK
app.post('/monday-webhook', async (req, res) => {

    // ✅ Monday verification
    if (req.body.challenge) {
        return res.status(200).json({ challenge: req.body.challenge });
    }

    try {
        const itemId = req.body.event?.pulseId;
        if (!itemId) return res.status(400).send("No itemId");

        // 🔹 Get item name
        const query = `
            query {
                items(ids: ${itemId}) {
                    name
                }
            }
        `;

        const response = await axios.post(
            MONDAY_API,
            { query },
            {
                headers: {
                    Authorization: process.env.MONDAY_API_TOKEN,
                    "Content-Type": "application/json"
                }
            }
        );

        const clientName = response.data.data.items[0].name;

        console.log("Creating channel for:", clientName);

        // 🔹 Create channel
        const channelId = await createUniqueChannel(clientName);

        // 🔹 Bot joins channel
        await slack.conversations.join({ channel: channelId });

        // 🔹 Add YOU to channel
        await slack.conversations.invite({
            channel: channelId,
            users: YOUR_USER_ID
        });

        // 🔹 Send message
        await slack.chat.postMessage({
            channel: channelId,
            text: `✅ Channel created for *${clientName}*`
        });

        res.status(200).send("Success");

    } catch (error) {
        console.error("ERROR:", error.response?.data || error.message);
        res.status(500).send("Error");
    }
});

// 🔥 START SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});