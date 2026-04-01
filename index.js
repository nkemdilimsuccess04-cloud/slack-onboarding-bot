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
CONFIG (CHANGE IF NEEDED)
===========================================
*/
const EMAIL_COLUMN_ID = "emailg3gyzi24";
const TIER_COLUMN_ID = "single_select62ell81";

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

    // ✅ verification
    if (req.body.challenge) {
        return res.status(200).json({ challenge: req.body.challenge });
    }

    // ✅ respond immediately
    res.status(200).send("Received");

    try {
        if (!req.body.event || !req.body.event.pulseId) return;

        const itemId = req.body.event.pulseId;

        // 🔹 Fetch full item
        const query = `
            query {
                items(ids: ${itemId}) {
                    name
                    column_values {
                        id
                        text
                    }
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

        const item = response.data.data.items[0];
        const clientName = item.name;
        const columns = item.column_values;

        const getColumn = (id) =>
            columns.find(col => col.id === id)?.text || "";

        const clientEmail = getColumn(EMAIL_COLUMN_ID);
        const tierText = getColumn(TIER_COLUMN_ID);

        // ❌ STOP if anything is missing
        if (!clientName || !clientEmail || !tierText) {
            console.log("Missing required data — skipping");
            return;
        }

        // ❌ STOP placeholder names
        if (clientName.toLowerCase() === "new item") {
            console.log("Placeholder item — skipping");
            return;
        }

        // 🔹 Convert tier → t1 / t2 / t3
        let tier = tierText.toLowerCase();

        if (tier.includes("1")) tier = "t1";
        else if (tier.includes("2")) tier = "t2";
        else if (tier.includes("3")) tier = "t3";
        else tier = "t1"; // fallback

        // 🔹 Build channel name
        let baseName = clientName
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9\-]/g, '');

        let finalName = `${baseName}-content-${tier}`;

        let count = 1;
        let channelId;

        // 🔹 Ensure unique name
        while (true) {
            try {
                const channel = await slack.conversations.create({
                    name: finalName,
                    is_private: true
                });

                channelId = channel.channel.id;
                break;

            } catch (error) {
                if (error.data?.error === "name_taken") {
                    finalName = `${baseName}-content-${tier}-${count}`;
                    count++;
                } else {
                    throw error;
                }
            }
        }

        // 🔹 Add YOU
        const userId = process.env.YOUR_SLACK_USER_ID;

        if (!userId) {
            console.error("Missing YOUR_SLACK_USER_ID");
            return;
        }

        await slack.conversations.invite({
            channel: channelId,
            users: userId
        });

        // 🔹 Confirmation message
        await slack.chat.postMessage({
            channel: channelId,
            text: `Channel created for ${clientName} (${tier.toUpperCase()}) ✅`
        });

    } catch (error) {
        console.error("ERROR:", error.response?.data || error.message);
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