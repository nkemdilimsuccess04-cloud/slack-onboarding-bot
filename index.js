require('dotenv').config();

const express = require('express');
const axios = require('axios');
const { WebClient } = require('@slack/web-api');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
const MONDAY_API = "https://api.monday.com/v2";

// 🔹 CONFIG
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
WAIT FOR COMPLETE DATA
===========================================
*/
async function waitForCompleteData(itemId) {
    for (let i = 0; i < 5; i++) {

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

        // ✅ Check if data is complete
        if (
            clientName &&
            clientEmail &&
            tierText &&
            clientName.toLowerCase() !== "new item"
        ) {
            return { clientName, clientEmail, tierText };
        }

        console.log("Waiting for complete data...");
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return null;
}

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

        // 🔥 WAIT for full data
        const data = await waitForCompleteData(itemId);

        if (!data) {
            console.log("Data never completed — skipping");
            return;
        }

        const { clientName, tierText } = data;

        console.log("Creating channel for:", clientName);

        // 🔹 Convert tier → t1 / t2 / t3
        let tier = tierText.toLowerCase();

        if (tier.includes("1")) tier = "t1";
        else if (tier.includes("2")) tier = "t2";
        else if (tier.includes("3")) tier = "t3";
        else tier = "t1";

        // 🔹 Clean name
        let baseName = clientName
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9\-]/g, '');

        let finalName = `${baseName}-content-${tier}`;

        let count = 1;
        let channelId;

        // 🔹 Ensure unique channel name
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

        // 🔹 Send confirmation
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