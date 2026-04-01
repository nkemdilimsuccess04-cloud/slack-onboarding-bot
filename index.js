require('dotenv').config();

const express = require('express');
const { WebClient } = require('@slack/web-api');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

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
MONDAY WEBHOOK (FINAL)
===========================================
*/
app.post('/monday-webhook', async (req, res) => {

    // verification
    if (req.body.challenge) {
        return res.status(200).json({ challenge: req.body.challenge });
    }

    // respond immediately
    res.status(200).send("Received");

    try {
        const event = req.body.event;
        if (!event) return;

        const clientName = event.pulseName;

        const tierColumn = event.columnValues?.single_select62ell81;

        // ❌ stop if missing
        if (!clientName || !tierColumn) {
            console.log("Missing name or tier");
            return;
        }

        // ❌ skip placeholder
        if (clientName.toLowerCase() === "new item") {
            console.log("Placeholder item");
            return;
        }

        // 🔹 extract tier label
        let tierText = "";

        try {
            const parsed = JSON.parse(tierColumn.value);
            tierText = parsed?.label || "";
        } catch {
            tierText = tierColumn.text || "";
        }

        if (!tierText) {
            console.log("Tier not set");
            return;
        }

        console.log("Creating channel for:", clientName, tierText);

        // 🔹 convert tier → t1 / t2 / t3
        let tier = tierText.toLowerCase();

        if (tier.includes("1")) tier = "t1";
        else if (tier.includes("2")) tier = "t2";
        else if (tier.includes("3")) tier = "t3";
        else tier = "t1";

        // 🔹 clean client name
        let baseName = clientName
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9\-]/g, '');

        // 🔥 FINAL FORMAT
        let finalName = `${baseName}-content-${tier}`;

        let count = 1;
        let channelId;

        // 🔹 ensure unique name
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

        // 🔹 add YOU
        await slack.conversations.invite({
            channel: channelId,
            users: process.env.YOUR_SLACK_USER_ID
        });

        // 🔹 confirmation
        await slack.chat.postMessage({
            channel: channelId,
            text: `Channel created: ${finalName} ✅`
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