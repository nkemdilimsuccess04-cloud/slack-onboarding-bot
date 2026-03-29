require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { WebClient } = require('@slack/web-api');

const app = express();
app.use(express.json());

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

const MONDAY_API = "https://api.monday.com/v2";

/*
===========================================
TIER → CALENDLY MAPPING
===========================================
*/
const tierCalendly = {
    "Basic": "https://calendly.com/your-basic-link",
    "Pro": "https://calendly.com/your-pro-link",
    "Premium": "https://calendly.com/your-premium-link"
};

/*
===========================================
CREATE UNIQUE CHANNEL
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
                is_private: false // ← safer for now
            });
            return response.channel.id;
        } catch (error) {
            if (error.data?.error === "name_taken") {
                name = `${base}-${count}`;
                count++;
            } else {
                console.error("Channel creation error:", error.data || error);
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
    try {

        // 👇 LOG EVERYTHING (VERY IMPORTANT)
        console.log("Webhook received:", JSON.stringify(req.body, null, 2));

        // Monday verification
        if (req.body.challenge) {
            return res.json({ challenge: req.body.challenge });
        }

        const itemId = req.body.event?.pulseId;

        if (!itemId) {
            console.log("No itemId found");
            return res.status(400).send("No itemId");
        }

        console.log("Item ID:", itemId);

        // Fetch item details from Monday
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

        const mondayResponse = await axios.post(
            MONDAY_API,
            { query },
            {
                headers: {
                    Authorization: process.env.MONDAY_API_TOKEN,
                    "Content-Type": "application/json"
                }
            }
        );

        const item = mondayResponse.data.data.items[0];

        const clientName = item.name;
        const columns = item.column_values;

        const getColumn = (id) =>
            columns.find(col => col.id === id)?.text || "";

        const clientEmail = getColumn("emailg3gyzi24");
        const tier = getColumn("single_select62ell81");

        console.log("Client:", clientName);
        console.log("Email:", clientEmail);
        console.log("Tier:", tier);

        const calendlyLink = tierCalendly[tier] || "https://calendly.com/default";

        // Create Slack channel
        const channelId = await createUniqueChannel(clientName);

        console.log("Channel created:", channelId);

        // Ensure bot joins channel
        await slack.conversations.join({
            channel: channelId
        });

        console.log("Bot joined channel");

        // Invite client via Slack Connect
        try {
            await slack.conversations.inviteShared({
                channel: channelId,
                emails: [clientEmail]
            });
            console.log("Slack Connect invite sent");
        } catch (inviteError) {
            console.error("Invite error:", inviteError.data || inviteError);
        }

        // Send welcome message
        await slack.chat.postMessage({
            channel: channelId,
            text: `Hi ${clientName} 👋

Welcome to your private onboarding workspace!

You are on the ${tier} plan.

📅 Book your onboarding call here:
${calendlyLink}

We’re excited to get started 🚀`
        });

        console.log("Welcome message sent");

        res.status(200).send("Success");

    } catch (error) {
        console.error("FULL ERROR:", error.response?.data || error.message || error);
        res.status(500).send("Internal server error");
    }
});

/*
===========================================
HEALTH CHECK (OPTIONAL BUT USEFUL)
===========================================
*/
app.get('/', (req, res) => {
    res.send("Server is running 🚀");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});