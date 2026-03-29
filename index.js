require('dotenv').config();

const express = require('express');
const axios = require('axios');
const { WebClient } = require('@slack/web-api');

const app = express();

// ✅ DEBUG (so we confirm ENV is working)
console.log("Slack Token:", process.env.SLACK_BOT_TOKEN);
console.log("Monday Token:", process.env.MONDAY_API_TOKEN);

// ✅ body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
const MONDAY_API = "https://api.monday.com/v2";

/*
===========================================
HEALTH CHECK
===========================================
*/
app.get('/test-slack', async (req, res) => {
    try {
        const channelId = await createUniqueChannel("test-client");

        console.log("Channel created:", channelId);

        // ✅ ADD YOURSELF (U0AF5TEDC8M)
        await slack.conversations.invite({
            channel: channelId,
            users: "U0AF5TEDC8M"
        });

        await slack.chat.postMessage({
            channel: channelId,
            text: "🚀 Your Slack bot is working!"
        });

        res.send("Slack test successful");
    } catch (err) {
        console.error("Slack Test Error FULL:", err.data || err);
        res.send("Slack test failed");
    }
});

/*
===========================================
TIER → CALENDLY
===========================================
*/
const tierCalendly = {
    "Basic": "https://calendly.com/your-basic-link",
    "Pro": "https://calendly.com/your-pro-link",
    "Premium": "https://calendly.com/your-premium-link"
};

/*
===========================================
CREATE CHANNEL
===========================================
*/
async function createUniqueChannel(baseName) {
    let base = baseName.toLowerCase().replace(/\s+/g, '-');
    let name = base;
    let count = 1;

    while (true) {
        try {
            const response = await slack.conversations.create({
                name: name,
                is_private: true // 🔥 make private (recommended)
            });
            return response.channel.id;
        } catch (error) {
            if (error.data?.error === "name_taken") {
                name = `${base}-${count}`;
                count++;
            } else {
                console.error("Channel error:", error.data || error);
                throw error;
            }
        }
    }
}

/*
===========================================
MONDAY WEBHOOK
===========================================
*/
app.post('/monday-webhook', async (req, res) => {

    if (req.body.challenge) {
        return res.status(200).json({ challenge: req.body.challenge });
    }

    try {
        console.log("Webhook received:", JSON.stringify(req.body, null, 2));

        const itemId = req.body.event?.pulseId;

        if (!itemId) {
            return res.status(400).send("No itemId");
        }

        // Fetch from Monday
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

        const clientEmail = getColumn("emailg3gyzi24");
        const tier = getColumn("single_select62ell81");

        console.log("Extracted:", clientName, clientEmail, tier);

        const calendlyLink = tierCalendly[tier] || "https://calendly.com/default";

        // Create channel
        const channelId = await createUniqueChannel(clientName);

        await slack.conversations.join({ channel: channelId });

        // Invite (optional)
        try {
            await slack.conversations.inviteShared({
                channel: channelId,
                emails: [clientEmail]
            });
        } catch (e) {
            console.log("Invite skipped or failed");
        }

        // Send message
        await slack.chat.postMessage({
            channel: channelId,
            text: `Hi ${clientName} 👋

Welcome to your onboarding workspace!

You are on the ${tier} plan.

📅 Book your onboarding call:
${calendlyLink}

We’re excited to work with you 🚀`
        });

        res.status(200).send("Success");

    } catch (error) {
        console.error("ERROR:", error.response?.data || error.message);
        res.status(500).send("Error");
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