require('dotenv').config();

const express = require('express');
const axios = require('axios');
const { WebClient } = require('@slack/web-api');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
const MONDAY_API = "https://api.monday.com/v2";

/*
===========================================
HEALTH CHECK
===========================================
*/
app.get('/', (req, res) => {
    res.send("Server is running 🚀");
});

/*
===========================================
MONDAY WEBHOOK
===========================================
*/
app.post('/monday-webhook', async (req, res) => {

    // ✅ Handle Monday verification
    if (req.body.challenge) {
        return res.status(200).json({ challenge: req.body.challenge });
    }

    // ✅ Respond immediately (VERY IMPORTANT)
    res.status(200).send("Received");

    try {
        console.log("Webhook:", req.body);

        if (!req.body.event || !req.body.event.pulseId) return;

        const itemId = req.body.event.pulseId;

        // 🔹 Fetch client name from Monday
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

        // 🔹 Clean channel name
        const channelName = clientName
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9\-]/g, '');

        // 🔹 Create PRIVATE channel
        const channel = await slack.conversations.create({
            name: channelName,
            is_private: true
        });

        const channelId = channel.channel.id;

        // 🔹 Add ONLY YOU
        await slack.conversations.invite({
            channel: channelId,
            users: process.env.YOUR_SLACK_USER_ID
        });

        // 🔹 Send confirmation message
        await slack.chat.postMessage({
            channel: channelId,
            text: `Private channel created for ${clientName} ✅`
        });

    } catch (error) {
        console.error("ERROR:", error.data || error.message);
    }
});

/*
===========================================
START SERVER
===========================================
*/
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});