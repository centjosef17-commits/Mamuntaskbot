require('dotenv').config();
const { Telegraf, Scenes, session } = require('telegraf');
const mongoose = require('mongoose');
const { faker } = require('@faker-js/faker');
const express = require('express');
const OTPAuth = require('otpauth');
const Redis = require('ioredis');
const xlsx = require('xlsx');

// ==========================================
// ১. MongoDB & Redis Setup 
// ==========================================
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('✅ MongoDB Connected Successfully!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

const UserSchema = new mongoose.Schema({
    telegramId: { type: String, unique: true }, name: String, earned: { type: Number, default: 0 },
    approved: { type: Number, default: 0 }, rejected: { type: Number, default: 0 },
    pending: { type: Number, default: 0 }, processing: { type: Number, default: 0 },
    shortRefId: { type: String, unique: true }, referrerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    refEarn: { type: Number, default: 0 }, refCount: { type: Number, default: 0 },
    joinDate: String, language: { type: String, default: 'bn' }, withdrawStatus: String
});
const User = mongoose.model('User', UserSchema);

const TaskSchema = new mongoose.Schema({
    name: String, price: Number, type: String, password: { type: String, default: 'Taskesy123@' },
    isUID: Boolean, is2FA: Boolean, isCookie: Boolean, rules: String, recoveryMail: String,
    status: { type: String, default: 'active' }
});
const Task = mongoose.model('Task', TaskSchema);

const SubmissionSchema = new mongoose.Schema({
    taskId: String, activeTaskId: String, taskName: String, taskType: String,
    username: String, firstName: String, lastName: String, fullName: String, generatedEmail: String,
    password: String, fbUid: String, secret2fa: String, cookie: String, recoveryMail: String,
    submittedBy: String, uid: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, price: Number,
    status: { type: String, default: 'pending' }, tgNotified: { type: Boolean, default: false },
    time: { type: Date, default: Date.now }
});
const Submission = mongoose.model('Submission', SubmissionSchema);

const WithdrawalSchema = new mongoose.Schema({
    uid: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, name: String, method: String, account: String,
    amount: Number, netAmount: Number, fee: Number, status: { type: String, default: 'pending' },
    tgNotified: { type: Boolean, default: false }, time: { type: Date, default: Date.now }
});
const Withdrawal = mongoose.model('Withdrawal', WithdrawalSchema);

const ConfigSchema = new mongoose.Schema({ key: String, value: String });
const Config = mongoose.model('Config', ConfigSchema);

async function getSetting(key, def) {
    let s = await Config.findOne({ key });
    if (!s) { s = await new Config({ key, value: def }).save(); }
    return s.value;
}
async function setSetting(key, value) {
    await Config.findOneAndUpdate({ key }, { value }, { upsert: true });
}

const bot = new Telegraf(process.env.BOT_TOKEN);
const redis = new Redis(process.env.REDIS_URL, { tls: { rejectUnauthorized: false }, maxRetriesPerRequest: null, enableReadyCheck: false });

redis.on('connect', () => console.log('✅ Redis Connected!'));
const CHANNEL_USERNAME = '@taskesy_news'; 

// ==========================================
// ২. Language Dictionary (i18n System)
// ==========================================
const langDB = {
    bn: {
        menu_tasks: '⚡ Tasks', menu_wallet: '💰 Wallet', menu_profile: '👤 Profile', menu_referral: '🎁 Referral', menu_top: '🏆 Top Users', menu_lang: '🌐 Language',
        return_home: '🔙 রিটার্ন to হোম', submit_btn: 'Submit', cancel: '❌ Cancel', start_btn: '▶️ Start',
        no_tasks: 'এই মুহূর্তে কোনো টাস্ক চালু নেই।', select_task: 'নিচের তালিকা থেকে একটি টাস্ক নির্বাচন করুন:',
        profile: (name, date, app, rej, pend, proc, earn) => `👤 **প্রোফাইল ইনফরমেশন**\n━━━━━━━━━━━━━━━━━━━━\n📛 **নাম:** ${name}\n📅 **জয়েন ডেট:** ${date}\n\n📊 **আপনার স্ট্যাটাস:**\n✅ **Approved:** \`${app}\` টি\n❌ **Rejected:** \`${rej}\` টি\n⏳ **Pending:** \`${pend}\` টি\n🔄 **Processing:** \`${proc}\` টি\n\n💵 **মোট আয়:** \`৳${earn}\`\n━━━━━━━━━━━━━━━━━━━━`,
        top_title: '🏆 **রিয়েল-টাইম লিডারবোর্ড (Top 10)**\n━━━━━━━━━━━━━━━━━━━━\n\n', top_empty: 'এখনও কোনো লিডারবোর্ড ডেটা নেই।',
        ref_text: (link, count, earn, comm) => `🎁 **রেফারেল প্রোগ্রাম**\n━━━━━━━━━━━━━━━━━━━━\nআপনার লিংক দিয়ে বন্ধুদের ইনভাইট করুন এবং তাদের টাস্ক কমপ্লিট হলে **${comm}% কমিশন** আয় করুন!\n\n🔗 **আপনার রেফার লিংক:**\n\`${link}\`\n\n👥 **মোট রেফার:** \`${count}\` জন\n💰 **রেফার থেকে আয়:** \`৳${earn}\`\n━━━━━━━━━━━━━━━━━━━━`,
        task_intro: (name, price, rules) => `⏳ Review time: 24 hours ⏳\n\n📋 Task: ${name} (৳${price})\n📄 Description: 📌 ${rules}\n✍️ Report instruction:\n.\n\n⏳ Review time: 24 hours ⏳`,
        details_ig_tw: (fName, uName, pass) => `First name: \`${fName}\`\nLogin: \`${uName}\`\nPassword: \`${pass}\``,
        details_fb: (fName, lName, pass) => `First name: \`${fName}\`\nLast name: \`${lName}\`\nPassword: \`${pass}\``,
        details_fb_gm: (fName, lName, email, pass) => `First name: \`${fName}\`\nLast name: \`${lName}\`\nEmail: \`${email}\`\nPassword: \`${pass}\``,
        uid_prompt: '🔑 অনুগ্রহ করে Facebook UID দিন:',
        tfa_prompt: '🔑 অনুগ্রহ করে কোড পেতে আপনার 2FA কী দিন:',
        cookie_prompt: '🔑 অনুগ্রহ করে Cookies দিন:',
        all_set: '✅ **আপনার সব তথ্য সঠিক! এখন টাস্কটি জমা দিতে নিচের "Submit" বাটনে ক্লিক করুন।**',
        task_success: '✅ আপনার Task টি সফলভাবে সাবমিট হয়েছে।',
        task_cancelled: '❌ টাস্ক বাতিল করা হয়েছে।',
        task_expired: '⏳ আপনার ১০ মিনিট সময় শেষ হয়ে গেছে। টাস্কটি স্বয়ংক্রিয়ভাবে বাতিল করা হলো।',
        wrong_cookie: '❌ Wrong cookies! দয়া করে সঠিক Cookies দিন:',
        wrong_2fa: '❌ Wrong 2FA secret! দয়া করে সঠিক 2FA দিন:',
        wrong_uid: '❌ Wrong UID! দয়া করে সঠিক Facebook UID দিন:',
        acc_cookie: '✅ Cookies Accepted!',
        acc_2fa: () => `✅ 2FA Accepted!\nলগইন করার জন্য আপনার OTP:`,
        acc_uid: '✅ UID Accepted!',
        missing_info: '⚠ এখনও সব তথ্য সঠিকভাবে দেওয়া হয়নি!',
        withdraw_prompt: 'কোন মেথডে উইথড্র করতে চান? নিচের বাটন থেকে নির্বাচন করুন:',
        withdraw_cancel: '❌ উইথড্র বাতিল করা হয়েছে।',
        withdraw_acc: (method) => `আপনি **${method}** সিলেক্ট করেছেন।\nদয়া করে আপনার একাউন্ট নম্বর বা আইডি দিন:`,
        withdraw_amt: 'টাকার পরিমাণ লিখুন (৳):',
        invalid_amt: 'দয়া করে সঠিক এমাউন্ট দিন।',
        low_bal: '❌ আপনার পর্যাপ্ত ব্যালেন্স নেই!',
        withdraw_receipt: (method, acc, amt, fee, net) => `✅ **উইথড্র রিকোয়েস্ট সাবমিট হয়েছে!**\n━━━━━━━━━━━━━━━━━━━━\n💳 **মেথড:** ${method}\n🏦 **একাউন্ট:** \`${acc}\`\n\n💰 **রিকোয়েস্ট এমাউন্ট:** ৳${amt}\n➖ **পেমেন্ট ফি:** ৳${fee}\n🎁 **আপনি রিসিভ করবেন:** ৳${net}\n━━━━━━━━━━━━━━━━━━━━`,
        force_join: '⚠️ **Bot ব্যবহার করতে হলে আগে আমাদের চ্যানেলে জয়েন করুন!**'
    },
    en: {
        menu_tasks: '⚡ Tasks', menu_wallet: '💰 Wallet', menu_profile: '👤 Profile', menu_referral: '🎁 Referral', menu_top: '🏆 Top Users', menu_lang: '🌐 Language',
        return_home: '🔙 Return to Home', submit_btn: 'Submit', cancel: '❌ Cancel', start_btn: '▶️ Start',
        no_tasks: 'No active tasks at the moment.', select_task: 'Select a task from the list below:',
        profile: (name, date, app, rej, pend, proc, earn) => `👤 **Profile Info**\n━━━━━━━━━━━━━━━━━━━━\n📛 **Name:** ${name}\n📅 **Join Date:** ${date}\n\n📊 **Your Status:**\n✅ **Approved:** \`${app}\`\n❌ **Rejected:** \`${rej}\`\n⏳ **Pending:** \`${pend}\`\n🔄 **Processing:** \`${proc}\`\n\n💵 **Total Earned:** \`৳${earn}\`\n━━━━━━━━━━━━━━━━━━━━`,
        top_title: '🏆 **Real-Time Leaderboard (Top 10)**\n━━━━━━━━━━━━━━━━━━━━\n\n', top_empty: 'No leaderboard data yet.',
        ref_text: (link, count, earn, comm) => `🎁 **Referral Program**\n━━━━━━━━━━━━━━━━━━━━\nInvite friends and earn **${comm}% commission** from their approved tasks!\n\n🔗 **Your Link:**\n\`${link}\`\n\n👥 **Total Referrals:** \`${count}\`\n💰 **Referral Earnings:** \`৳${earn}\`\n━━━━━━━━━━━━━━━━━━━━`,
        task_intro: (name, price, rules) => `⏳ Review time: 24 hours ⏳\n\n📋 Task: ${name} (৳${price})\n📄 Description: 📌Follow the rules given above and work. If you do not follow the rules, the report will be rejected ❌\n✍️ Report instruction:\n.\n\n⏳ Review time: 24 hours ⏳`,
        details_ig_tw: (fName, uName, pass) => `First name: \`${fName}\`\nLogin: \`${uName}\`\nPassword: \`${pass}\``,
        details_fb: (fName, lName, pass) => `First name: \`${fName}\`\nLast name: \`${lName}\`\nPassword: \`${pass}\``,
        details_fb_gm: (fName, lName, email, pass) => `First name: \`${fName}\`\nLast name: \`${lName}\`\nEmail: \`${email}\`\nPassword: \`${pass}\``,
        uid_prompt: '🔑 Please enter Facebook UID:',
        tfa_prompt: '🔑 Please enter your 2FA key to get the code:',
        cookie_prompt: '🔑 Please enter Cookies:',
        all_set: '✅ **All data collected! Click "Submit" below to submit.**',
        task_success: '✅ Your Task has been submitted successfully.',
        task_cancelled: '❌ Task cancelled.',
        task_expired: '⏳ 10 minutes time limit exceeded. Task auto-cancelled.',
        wrong_cookie: '❌ Wrong cookies! Please submit valid Cookies:',
        wrong_2fa: '❌ Wrong 2FA secret! Please submit a valid 2FA:',
        wrong_uid: '❌ Wrong UID! Please submit a valid Facebook UID:',
        acc_cookie: '✅ Cookies Accepted!',
        acc_2fa: () => `✅ 2FA Accepted!\nYour OTP for login:`,
        acc_uid: '✅ UID Accepted!',
        missing_info: '⚠️ All information is not correctly provided yet!',
        withdraw_prompt: 'Select your preferred withdrawal method:',
        withdraw_cancel: '❌ Withdrawal cancelled.',
        withdraw_acc: (method) => `You selected **${method}**.\nPlease enter your account number/ID:`,
        withdraw_amt: 'Enter withdrawal amount (৳):',
        invalid_amt: 'Please enter a valid amount.',
        low_bal: '❌ Insufficient balance!',
        withdraw_receipt: (method, acc, amt, fee, net) => `✅ **Withdrawal Request Submitted!**\n━━━━━━━━━━━━━━━━━━━━\n💳 **Method:** ${method}\n🏦 **Account:** \`${acc}\`\n\n💰 **Request Amount:** ৳${amt}\n➖ **Payment Fee:** ৳${fee}\n🎁 **You Will Receive:** ৳${net}\n━━━━━━━━━━━━━━━━━━━━`,
        force_join: '⚠️ **Please join our channel to use the Bot!**'
    }
};

async function getLang(ctx) {
    if (ctx.session && ctx.session.lang) return ctx.session.lang;
    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) return 'bn';
    try { const u = await User.findOne({ telegramId }); if (u) { if (ctx.session) ctx.session.lang = u.language || 'bn'; return u.language || 'bn'; } } catch(e) {}
    return 'bn';
}

const checkAdmin = (ctx) => ctx.from?.id?.toString() === process.env.ADMIN_ID;

function getMainMenu(lang, isAdmin = false) {
    const keyboard = [
        [ { text: langDB[lang].menu_wallet, style: 'success' }, { text: langDB[lang].menu_tasks, style: 'primary' } ],
        [ { text: langDB[lang].menu_profile, style: 'primary' } ],
        [ { text: langDB[lang].menu_referral, style: 'primary' }, { text: langDB[lang].menu_top, style: 'primary' } ],
        [ { text: langDB[lang].menu_lang, style: 'primary' } ]
    ];
    if (isAdmin) keyboard.push([{ text: '👑 Admin Panel', style: 'danger' }]); 
    return { keyboard, resize_keyboard: true };
}

// ==========================================
// ৩. Session, Config & Middleware
// ==========================================
bot.use(session()); 

bot.use(async (ctx, next) => {
    const telegramId = ctx.from?.id?.toString();
    const isAdmin = checkAdmin(ctx);
    const botStatus = await getSetting('botStatus', 'on');
    const maintenance = await getSetting('maintenance', 'off');

    if (!isAdmin) {
        if (botStatus === 'off') return;
        if (maintenance === 'on') {
            if (ctx.message && ctx.message.text && (ctx.message.text.startsWith('/start') || ctx.message.text === '👑 Admin Panel')) {} 
            else { try { if (ctx.message || ctx.callbackQuery) await ctx.reply("⚙️ Bot is currently under maintenance. Please try again later."); } catch(e){} return; }
        }
    }

    if (ctx.message && ctx.message.text && ctx.message.text.startsWith('/start')) {
        const parts = ctx.message.text.split(' ');
        if (parts.length > 1 && telegramId) { try { await redis.set(`ref_${telegramId}`, parts[1], 'EX', 3600); } catch(e){} }
    }
    if (ctx.type === 'callback_query' && (ctx.callbackQuery.data === 'check_join' || ctx.callbackQuery.data.startsWith('SET_LANG_') || ctx.callbackQuery.data.startsWith('ADMIN_'))) return next();
    
    if (ctx.chat && ctx.chat.type === 'private' && telegramId && !isAdmin) {
        try {
            const member = await ctx.telegram.getChatMember(CHANNEL_USERNAME, ctx.from.id);
            if (['member', 'administrator', 'creator'].includes(member.status)) return next();
            else {
                const lang = await getLang(ctx);
                return ctx.reply(langDB[lang].force_join, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📢 Channel', url: `https://t.me/${CHANNEL_USERNAME.replace('@', '')}` }], [{ text: '✅ Joined', callback_data: 'check_join', style: 'success' }]] } });
            }
        } catch (e) { return next(); }
    }
    return next();
});

// ==========================================
// ৪. Reusable Functions
// ==========================================
async function showTasks(ctx) {
    const taskStatus = await getSetting('taskStatus', 'on');
    if (taskStatus === 'off' && !checkAdmin(ctx)) return ctx.reply("⚠️ Currently task submission is disabled.");
    
    const lang = await getLang(ctx);
    const tasks = await Task.find({ status: 'active' });
    if (tasks.length === 0) return ctx.reply(langDB[lang].no_tasks);
    let buttons = tasks.map(t => [{ text: `⚡ ${t.name} - ৳${t.price}`, callback_data: `VIEW_TASK_${t._id}`, style: 'primary' }]);
    ctx.reply(langDB[lang].select_task, { reply_markup: { inline_keyboard: buttons } });
}

async function showWallet(ctx) {
    const lang = await getLang(ctx);
    const u = await User.findOne({ telegramId: ctx.from.id.toString() });
    if (!u) return;
    const earned = parseFloat(u.earned || 0).toFixed(2);
    const withdrawals = await Withdrawal.find({ uid: u._id });
    let pendingWithdraw = 0, successWithdraw = 0;
    withdrawals.forEach(w => { if (w.status === 'pending') pendingWithdraw += parseFloat(w.amount || 0); else if (w.status === 'approved') successWithdraw += parseFloat(w.amount || 0); });
    const walletText = lang === 'bn' ? `💰 **আপনার ওয়ালেট**\n━━━━━━━━━━━━━━━━━━━━\n💵 **মেইন ব্যালেন্স:** \`৳${earned}\`\n\n⏳ **উইথড্র পেন্ডিং:** \`৳${pendingWithdraw.toFixed(2)}\`\n✅ **মোট উইথড্র (সাকসেস):** \`৳${successWithdraw.toFixed(2)}\`\n━━━━━━━━━━━━━━━━━━━━` : `💰 **Your Wallet**\n━━━━━━━━━━━━━━━━━━━━\n💵 **Main Balance:** \`৳${earned}\`\n\n⏳ **Pending Withdrawal:** \`৳${pendingWithdraw.toFixed(2)}\`\n✅ **Total Success Withdrawal:** \`৳${successWithdraw.toFixed(2)}\`\n━━━━━━━━━━━━━━━━━━━━`;
    ctx.reply(walletText, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: lang === 'bn' ? '💸 উইথড্র করুন' : '💸 Withdraw', callback_data: `WITHDRAW_${u._id}`, style: 'primary' }]] } });
}

async function showProfile(ctx) {
    const lang = await getLang(ctx);
    const u = await User.findOne({ telegramId: ctx.from.id.toString() });
    if (!u) return;
    ctx.reply(langDB[lang].profile(u.name, u.joinDate || 'N/A', u.approved || 0, u.rejected || 0, u.pending || 0, u.processing || 0, parseFloat(u.earned || 0).toFixed(2)), { parse_mode: 'Markdown' });
}

async function showTopUsers(ctx) {
    const lang = await getLang(ctx);
    const topUsers = await User.find({ approved: { $gt: 0 } }).sort({ approved: -1 }).limit(10);
    let text = langDB[lang].top_title;
    if (topUsers.length === 0) text = langDB[lang].top_empty;
    else topUsers.forEach((u, i) => { text += `${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '🎖️'} **${u.name}**\n     ↳ \`${u.approved}\` Approved\n\n`; });
    ctx.reply(text, { parse_mode: 'Markdown' });
}

async function showReferral(ctx) {
    const lang = await getLang(ctx);
    const u = await User.findOne({ telegramId: ctx.from.id.toString() });
    if (!u) return;
    const botInfo = await bot.telegram.getMe();
    const refLink = `https://t.me/${botInfo.username}?start=${u.telegramId}`;
    const comm = await getSetting('refCommission', '0');
    ctx.reply(langDB[lang].ref_text(refLink, u.refCount || 0, parseFloat(u.refEarn || 0).toFixed(2), comm), { parse_mode: 'Markdown' });
}

// ==========================================
// ৫. User Scenes (Task Submission & Withdrawal)
// ==========================================
const taskWizard = new Scenes.WizardScene('TASK_WIZARD',
    async (ctx) => {
        const lang = await getLang(ctx);
        const task = ctx.scene.state.taskData;
        const fakeUser = ctx.scene.state.fakeUser;
        ctx.scene.session.taskData = task; ctx.scene.session.fakeUser = fakeUser; ctx.scene.session.userId = ctx.scene.state.userId; ctx.scene.session.startTime = Date.now(); 
        
        let detailsText = '';
        const lowerType = task.type ? task.type.toLowerCase() : '';
        if (['ig', 'instagram', 'twitter', 'tiktok'].includes(lowerType)) detailsText = langDB[lang].details_ig_tw(fakeUser.firstName, fakeUser.username, task.password || 'Taskesy123@');
        else if (['fb', 'facebook'].includes(lowerType)) detailsText = langDB[lang].details_fb(fakeUser.firstName, fakeUser.lastName, task.password || 'Taskesy123@');
        else detailsText = langDB[lang].details_fb_gm(fakeUser.firstName, fakeUser.lastName, fakeUser.email, task.password || 'Taskesy123@');
        
        ctx.scene.session.steps = [];
        if (task.isUID) ctx.scene.session.steps.push('uid'); 
        if (task.is2FA) ctx.scene.session.steps.push('2fa'); 
        if (task.isCookie) ctx.scene.session.steps.push('cookie'); 
        
        ctx.scene.session.collected = { uid: '', secret2fa: '', cookie: '' };
        const sentMsg = await ctx.reply(detailsText, { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } });
        ctx.scene.session.taskMessageId = sentMsg.message_id;
        ctx.scene.session.timeoutId = setTimeout(async () => { try { await bot.telegram.deleteMessage(ctx.chat.id, sentMsg.message_id).catch(()=>{}); await bot.telegram.sendMessage(ctx.chat.id, langDB[lang].task_expired, { reply_markup: getMainMenu(lang, checkAdmin(ctx)) }).catch(()=>{}); if (ctx.session) ctx.session.__scenes = {}; } catch(e) {} }, 10 * 60 * 1000);
        return askNextRequirement(ctx, lang); 
    },
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return;
        const text = ctx.message.text.trim();
        const lang = await getLang(ctx);
        if (Date.now() - ctx.scene.session.startTime > 10 * 60 * 1000) { if (ctx.scene.session.timeoutId) clearTimeout(ctx.scene.session.timeoutId); return; }
        const menuCommands = [langDB.bn.menu_tasks, langDB.en.menu_tasks, langDB.bn.menu_wallet, langDB.en.menu_wallet, langDB.bn.menu_profile, langDB.en.menu_profile, langDB.bn.menu_top, langDB.en.menu_top, langDB.bn.menu_referral, langDB.en.menu_referral, langDB.bn.cancel, langDB.en.cancel, '/cancel'];
        if (menuCommands.includes(text)) { if (ctx.scene.session.timeoutId) clearTimeout(ctx.scene.session.timeoutId); await ctx.reply(langDB[lang].task_cancelled, { reply_markup: getMainMenu(lang, checkAdmin(ctx)) }); return ctx.scene.leave(); }
        if (text === langDB.bn.submit_btn || text === langDB.en.submit_btn) {
            if (ctx.scene.session.timeoutId) clearTimeout(ctx.scene.session.timeoutId);
            if (ctx.scene.session.steps.length > 0) return ctx.reply(langDB[lang].missing_info);
            const tData = ctx.scene.session.taskData; const fUser = ctx.scene.session.fakeUser; const col = ctx.scene.session.collected; const uId = ctx.scene.session.userId;
            const generatedTaskId = "WP-" + Math.floor(10000 + Math.random() * 90000);
            try {
                const sub = new Submission({ taskId: generatedTaskId, activeTaskId: tData._id.toString(), taskName: tData.name, taskType: tData.type, username: fUser.username || "", firstName: fUser.firstName || "", lastName: fUser.lastName || "", fullName: `${fUser.firstName}${fUser.lastName}`, generatedEmail: fUser.email || "", password: tData.password || "Taskesy123@", fbUid: col.uid || "", secret2fa: col.secret2fa || "", cookie: col.cookie || "", recoveryMail: tData.recoveryMail || "", submittedBy: ctx.from.id.toString(), uid: uId, price: tData.price });
                await sub.save(); await User.findByIdAndUpdate(uId, { $inc: { pending: 1 } });
                if (ctx.scene.session.taskMessageId) ctx.telegram.deleteMessage(ctx.chat.id, ctx.scene.session.taskMessageId).catch(()=>{});
                ctx.reply(langDB[lang].task_success, { reply_markup: getMainMenu(lang, checkAdmin(ctx)) });
            } catch(e) { console.error(e); }
            return ctx.scene.leave();
        }
        if (ctx.scene.session.steps.length > 0) {
            let currentStep = ctx.scene.session.steps[0];
            if (currentStep === 'cookie') {
                if (text.length < 15 || !text.includes('=')) return ctx.reply(langDB[lang].wrong_cookie);
                const lowerType = ctx.scene.session.taskData.type ? ctx.scene.session.taskData.type.toLowerCase() : '';
                if (['fb', 'facebook'].includes(lowerType)) {
                    const match = text.match(/c_user=(\d+)/); if (match && match[1]) ctx.scene.session.collected.uid = match[1]; else return ctx.reply(lang === 'bn' ? '❌ Cookies-এ c_user পাওয়া যায়নি!' : '❌ c_user not found in Cookies!');
                }
                ctx.scene.session.collected.cookie = text; ctx.scene.session.steps.shift(); await ctx.reply(langDB[lang].acc_cookie);
            }
            else if (currentStep === '2fa') {
                try { let totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(text.replace(/\s+/g, '').toUpperCase()) }); let token = totp.generate(); ctx.scene.session.collected.secret2fa = text; ctx.scene.session.steps.shift(); await ctx.reply(langDB[lang].acc_2fa(), { reply_markup: { inline_keyboard: [[{ text: `📋 ${token}`, copy_text: { text: token }, style: 'primary' }]] } }); } catch(e) { return ctx.reply(langDB[lang].wrong_2fa); }
            }
            else if (currentStep === 'uid') { if (text.length < 4) return ctx.reply(langDB[lang].wrong_uid); ctx.scene.session.collected.uid = text; ctx.scene.session.steps.shift(); await ctx.reply(langDB[lang].acc_uid); }
            return askNextRequirement(ctx, lang);
        }
    }
);

async function askNextRequirement(ctx, lang) {
    const steps = ctx.scene.session.steps; const kbd = { keyboard: [[{ text: langDB[lang].cancel, style: 'danger' }]], resize_keyboard: true };
    if (steps.length > 0) {
        const next = steps[0];
        if (next === 'uid') await ctx.reply(langDB[lang].uid_prompt, { reply_markup: kbd }); else if (next === '2fa') await ctx.reply(langDB[lang].tfa_prompt, { reply_markup: kbd }); else if (next === 'cookie') await ctx.reply(langDB[lang].cookie_prompt, { reply_markup: kbd });
        ctx.wizard.selectStep(1); 
    } else { await ctx.reply(langDB[lang].all_set, { reply_markup: { keyboard: [[{ text: langDB[lang].submit_btn, style: 'success' }], [{ text: langDB[lang].cancel, style: 'danger' }]], resize_keyboard: true }, parse_mode: 'Markdown' }); ctx.wizard.selectStep(1); }
}

const withdrawWizard = new Scenes.WizardScene('WITHDRAW_WIZARD',
    async (ctx) => {
        const lang = await getLang(ctx); ctx.scene.session.lang = lang;
        ctx.reply(langDB[lang].withdraw_prompt, { reply_markup: { inline_keyboard: [[{ text: 'bKash', callback_data: 'bkash', style: 'primary' }, { text: 'Nagod', callback_data: 'nagod', style: 'primary' }], [{ text: 'Binance', callback_data: 'binance', style: 'primary' }], [{ text: '❌ Cancel', callback_data: 'cancel', style: 'danger' }]] } });
        return ctx.wizard.next();
    },
    async (ctx) => {
        const lang = ctx.scene.session.lang;
        if (ctx.callbackQuery) {
            const method = ctx.callbackQuery.data;
            if (method === 'cancel') { await ctx.answerCbQuery(); ctx.reply(langDB[lang].withdraw_cancel, { reply_markup: getMainMenu(lang, checkAdmin(ctx)) }); return ctx.scene.leave(); }
            ctx.wizard.state.method = method; await ctx.answerCbQuery();
            const mNames = { bkash: 'bKash', nagod: 'Nagod', binance: 'Binance' };
            ctx.reply(langDB[lang].withdraw_acc(mNames[method]), { parse_mode: 'Markdown', reply_markup: { keyboard: [[{ text: langDB[lang].cancel, style: 'danger' }]], resize_keyboard: true } });
            return ctx.wizard.next();
        } 
    },
    async (ctx) => {
        const lang = ctx.scene.session.lang;
        if (ctx.message.text === langDB[lang].cancel) { ctx.reply(langDB[lang].withdraw_cancel, { reply_markup: getMainMenu(lang, checkAdmin(ctx)) }); return ctx.scene.leave(); }
        ctx.wizard.state.account = ctx.message.text; ctx.reply(langDB[lang].withdraw_amt); return ctx.wizard.next();
    },
    async (ctx) => {
        const lang = ctx.scene.session.lang;
        if (ctx.message.text === langDB[lang].cancel) { ctx.reply(langDB[lang].withdraw_cancel, { reply_markup: getMainMenu(lang, checkAdmin(ctx)) }); return ctx.scene.leave(); }
        const amount = parseFloat(ctx.message.text); if (isNaN(amount) || amount <= 0) return ctx.reply(langDB[lang].invalid_amt);
        const u = await User.findById(ctx.wizard.state.userId); const method = ctx.wizard.state.method;
        if (amount > u.earned) { ctx.reply(langDB[lang].low_bal, { reply_markup: getMainMenu(lang, checkAdmin(ctx)) }); return ctx.scene.leave(); }
        const feeConfig = await Config.findOne({ key: `${method}Fee` }); let feePercent = feeConfig ? parseFloat(feeConfig.value) : 0;
        const fee = (amount * feePercent) / 100; const netAmount = amount - fee;
        try {
            await new Withdrawal({ uid: u._id, name: u.name, method, account: ctx.wizard.state.account, amount, netAmount, fee }).save();
            await User.findByIdAndUpdate(u._id, { $inc: { earned: -amount }, withdrawStatus: 'Pending' });
            ctx.reply(langDB[lang].withdraw_receipt(method.toUpperCase(), ctx.wizard.state.account, amount.toFixed(2), fee.toFixed(2), netAmount.toFixed(2)), { parse_mode: 'Markdown', reply_markup: getMainMenu(lang, checkAdmin(ctx)) });
        } catch (e) { console.error(e); }
        return ctx.scene.leave();
    }
);

// ==========================================
// ৬. Admin Scenes 
// ==========================================
const adminBroadcastWizard = new Scenes.WizardScene('ADMIN_BROADCAST_WIZARD',
    async (ctx) => {
        ctx.reply("📢 ইউজারদের কাছে কী মেসেজ পাঠাতে চান তা লিখুন।\n\nবাতিল করতে লিখুন: /cancel", { reply_markup: { keyboard: [[{ text: '/cancel', style: 'danger' }]], resize_keyboard: true } });
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.message.text) return;
        if (ctx.message.text === '/cancel') { ctx.reply("❌ ব্রডকাস্ট বাতিল করা হয়েছে।", { reply_markup: getMainMenu(await getLang(ctx), true) }); return ctx.scene.leave(); }
        ctx.reply("⏳ ব্রডকাস্ট মেসেজ পাঠানো শুরু হচ্ছে...");
        const users = await User.find({ telegramId: { $ne: null } }); let count = 0;
        for (const u of users) { try { await bot.telegram.sendMessage(u.telegramId, ctx.message.text, { parse_mode: 'Markdown' }); count++; } catch (e) { } }
        ctx.reply(`✅ ব্রডকাস্ট সম্পূর্ণ হয়েছে! মোট ${count} জন ইউজারকে মেসেজ পাঠানো হয়েছে।`, { reply_markup: getMainMenu(await getLang(ctx), true) }); return ctx.scene.leave();
    }
);

const adminAddTaskWizard = new Scenes.WizardScene('ADMIN_ADD_TASK_WIZARD',
    async (ctx) => {
        await ctx.reply("🛠️ **কোন প্ল্যাটফর্মের টাস্ক অ্যাড করতে চান?**\n(বাতিল করতে /cancel লিখুন)", { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: 'Facebook', callback_data: 'PLATFORM_Facebook', style: 'primary' }, { text: 'Instagram', callback_data: 'PLATFORM_Instagram', style: 'primary' }],
            [{ text: 'Twitter', callback_data: 'PLATFORM_Twitter', style: 'primary' }, { text: 'Tiktok', callback_data: 'PLATFORM_Tiktok', style: 'primary' }]
        ]}});
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message && ctx.message.text === '/cancel') { ctx.reply("❌ বাতিল করা হয়েছে।", { reply_markup: getMainMenu(await getLang(ctx), true) }); return ctx.scene.leave(); }
        if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('PLATFORM_')) return;
        ctx.wizard.state.platform = ctx.callbackQuery.data.split('_')[1]; await ctx.answerCbQuery();
        await ctx.editMessageText(`✅ **${ctx.wizard.state.platform}** সিলেক্ট করা হয়েছে।\n\nএবার টাস্কের ধরণ সিলেক্ট করুন:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
            [{ text: '🔑 2FA', callback_data: 'TYPE_2fa', style: 'primary' }, { text: '🍪 Cookies', callback_data: 'TYPE_cookie', style: 'primary' }],
            [{ text: '🔑 + 🍪 Both', callback_data: 'TYPE_both', style: 'success' }]
        ]}});
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message && ctx.message.text === '/cancel') { ctx.reply("❌ বাতিল করা হয়েছে।", { reply_markup: getMainMenu(await getLang(ctx), true) }); return ctx.scene.leave(); }
        if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('TYPE_')) return;
        const type = ctx.callbackQuery.data.split('_')[1];
        ctx.wizard.state.is2FA = (type === '2fa' || type === 'both'); ctx.wizard.state.isCookie = (type === 'cookie' || type === 'both'); await ctx.answerCbQuery();
        await ctx.editMessageText("📝 **টাস্কের ইন্সট্রাকশন বা নিয়ম লিখুন:**\n\n(না দিতে চাইলে নিচের 'Skip' বাটনে ক্লিক করুন)", { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⏭️ Skip', callback_data: 'SKIP_INSTRUCTION', style: 'danger' }]] }});
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message && ctx.message.text === '/cancel') { ctx.reply("❌ বাতিল করা হয়েছে।", { reply_markup: getMainMenu(await getLang(ctx), true) }); return ctx.scene.leave(); }
        if (ctx.callbackQuery && ctx.callbackQuery.data === 'SKIP_INSTRUCTION') {
            ctx.wizard.state.rules = "উপরের নিয়মগুলো মেনে কাজ করুন। নিয়ম না মানলে রিপোর্ট বাতিল করা হবে ❌"; await ctx.answerCbQuery();
            await ctx.editMessageText("💰 **টাস্কের প্রাইস বা টাকার পরিমাণ দিন:**\n(যেমন: 10)", { parse_mode: 'Markdown' });
        } else if (ctx.message && ctx.message.text) { ctx.wizard.state.rules = ctx.message.text; await ctx.reply("💰 **টাস্কের প্রাইস বা টাকার পরিমাণ দিন:**\n(যেমন: 10)", { parse_mode: 'Markdown' }); } else return;
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message && ctx.message.text === '/cancel') { ctx.reply("❌ বাতিল করা হয়েছে।", { reply_markup: getMainMenu(await getLang(ctx), true) }); return ctx.scene.leave(); }
        if (!ctx.message || !ctx.message.text) return;
        const price = parseFloat(ctx.message.text); if (isNaN(price) || price <= 0) return ctx.reply("⚠️ দয়া করে সঠিক টাকার পরিমাণ দিন:");
        ctx.wizard.state.price = price; await ctx.reply("🔐 **টাস্কের পাসওয়ার্ড দিন:**\n(যেমন: Taskesy123@)", { parse_mode: 'Markdown' });
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message && ctx.message.text === '/cancel') { ctx.reply("❌ বাতিল করা হয়েছে।", { reply_markup: getMainMenu(await getLang(ctx), true) }); return ctx.scene.leave(); }
        if (!ctx.message || !ctx.message.text) return;
        ctx.wizard.state.password = ctx.message.text;
        const isFB = ['fb', 'facebook'].includes(ctx.wizard.state.platform.toLowerCase());
        try {
            await new Task({ name: `${ctx.wizard.state.platform} Task`, type: ctx.wizard.state.platform.toLowerCase(), price: ctx.wizard.state.price, password: ctx.wizard.state.password, isUID: isFB, is2FA: ctx.wizard.state.is2FA, isCookie: ctx.wizard.state.isCookie, rules: ctx.wizard.state.rules, status: 'active' }).save();
            await ctx.reply("✅ **সাকসেসফুলি টাস্ক অ্যাড করা হয়েছে!**\nইউজাররা এখন এই টাস্কটি দেখতে পাবে।", { parse_mode: 'Markdown', reply_markup: getMainMenu(await getLang(ctx), true) });
        } catch(e) { await ctx.reply("❌ ডাটাবেসে সেভ করতে সমস্যা হয়েছে।", { reply_markup: getMainMenu(await getLang(ctx), true) }); }
        return ctx.scene.leave();
    }
);

const adminEditTaskWizard = new Scenes.WizardScene('ADMIN_EDIT_TASK_WIZARD',
    async (ctx) => {
        const action = ctx.scene.state.action; const task = ctx.scene.state.task; ctx.wizard.state.action = action; ctx.wizard.state.taskId = task._id;
        if (action === 'price') await ctx.reply(`💰 **${task.name}** এর বর্তমান প্রাইস ৳${task.price}।\n\nনতুন প্রাইস লিখুন (বাতিল করতে /cancel):`, { parse_mode: 'Markdown', reply_markup: { keyboard: [[{ text: '/cancel', style: 'danger' }]], resize_keyboard: true } });
        else if (action === 'pass') await ctx.reply(`🔐 **${task.name}** এর বর্তমান পাসওয়ার্ড: \`${task.password}\`\n\nনতুন পাসওয়ার্ড লিখুন (বাতিল করতে /cancel):`, { parse_mode: 'Markdown', reply_markup: { keyboard: [[{ text: '/cancel', style: 'danger' }]], resize_keyboard: true } });
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return;
        if (ctx.message.text === '/cancel') { ctx.reply("❌ পরিবর্তন বাতিল করা হয়েছে।", { reply_markup: getMainMenu(await getLang(ctx), true) }); return ctx.scene.leave(); }
        const action = ctx.wizard.state.action; const taskId = ctx.wizard.state.taskId;
        try {
            if (action === 'price') { const p = parseFloat(ctx.message.text); if (isNaN(p) || p <= 0) return ctx.reply("⚠️ সঠিক টাকার পরিমাণ দিন:"); await Task.findByIdAndUpdate(taskId, { price: p }); }
            else if (action === 'pass') { await Task.findByIdAndUpdate(taskId, { password: ctx.message.text }); }
            await ctx.reply("✅ **টাস্ক সফলভাবে আপডেট করা হয়েছে!**", { parse_mode: 'Markdown', reply_markup: getMainMenu(await getLang(ctx), true) });
        } catch(e) { await ctx.reply("❌ এরর!", { reply_markup: getMainMenu(await getLang(ctx), true) }); }
        return ctx.scene.leave();
    }
);

const adminRefCommWizard = new Scenes.WizardScene('ADMIN_REF_COMM_WIZARD',
    async (ctx) => {
        ctx.reply("🎁 **রেফারেল কমিশন (%) লিখুন:**\n(যেমন: 10)\n\nবাতিল করতে লিখুন: /cancel", { parse_mode: 'Markdown', reply_markup: { keyboard: [[{ text: '/cancel', style: 'danger' }]], resize_keyboard: true } });
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return;
        if (ctx.message.text === '/cancel') { ctx.reply("❌ বাতিল করা হয়েছে।", { reply_markup: getMainMenu(await getLang(ctx), true) }); return ctx.scene.leave(); }
        const val = parseFloat(ctx.message.text);
        if (isNaN(val) || val < 0) return ctx.reply("⚠️ সঠিক সংখ্যা দিন:");
        await setSetting('refCommission', val.toString());
        ctx.reply(`✅ রেফারেল কমিশন ${val}% এ সেট করা হয়েছে!`, { reply_markup: getMainMenu(await getLang(ctx), true) });
        return ctx.scene.leave();
    }
);

const stage = new Scenes.Stage([taskWizard, withdrawWizard, adminBroadcastWizard, adminAddTaskWizard, adminEditTaskWizard, adminRefCommWizard]);
bot.use(stage.middleware());

// ==========================================
// ৭. User Handlers
// ==========================================
async function registerUser(ctx) {
    const telegramId = ctx.from.id.toString(); const existing = await User.findOne({ telegramId });
    if (!existing) {
        let referrerId = null; let payload = null; try { payload = await redis.get(`ref_${telegramId}`); } catch(e){}
        if (payload && payload !== telegramId) { 
            const refUser = await User.findOne({ telegramId: payload }); 
            if (refUser) { referrerId = refUser._id; await User.findByIdAndUpdate(referrerId, { $inc: { refCount: 1 } }); bot.telegram.sendMessage(refUser.telegramId, `🎉 You have successfully invited a User: **${ctx.from.first_name}**`, { parse_mode: 'Markdown' }).catch(console.error); } 
        }
        await new User({ telegramId, name: ctx.from.first_name, shortRefId: Math.random().toString(36).substring(2, 8).toUpperCase(), referrerId, joinDate: new Date().toLocaleDateString('en-GB') }).save();
    }
}

bot.action('check_join', async (ctx) => {
    try {
        const member = await ctx.telegram.getChatMember(CHANNEL_USERNAME, ctx.from.id);
        if (['member', 'administrator', 'creator'].includes(member.status)) { await ctx.deleteMessage(); await registerUser(ctx); const lang = await getLang(ctx); await ctx.reply(lang === 'bn' ? '✅ ধন্যবাদ! এখন আপনি Bot টি ব্যবহার করতে পারবেন।' : '✅ Thank you! You can now use the Bot.', { reply_markup: getMainMenu(lang, checkAdmin(ctx)) }); } 
        else await ctx.answerCbQuery('❌ আপনি এখনও জয়েন করেননি!', { show_alert: true });
    } catch (e) { await ctx.answerCbQuery('❌ Error!', { show_alert: true }); }
});

bot.action('SET_LANG_BN', async (ctx) => { await ctx.answerCbQuery().catch(()=>{}); await updateLang(ctx, 'bn'); });
bot.action('SET_LANG_EN', async (ctx) => { await ctx.answerCbQuery().catch(()=>{}); await updateLang(ctx, 'en'); });
async function updateLang(ctx, lang) { if (!ctx.session) ctx.session = {}; ctx.session.lang = lang; await User.findOneAndUpdate({ telegramId: ctx.from.id.toString() }, { language: lang }); await ctx.deleteMessage().catch(()=>{}); ctx.reply(lang === 'bn' ? '✅ ভাষা বাংলায় পরিবর্তন করা হয়েছে।' : '✅ Language updated to English.', { reply_markup: getMainMenu(lang, checkAdmin(ctx)) }); }

bot.start(async (ctx) => { 
    const botStatus = await getSetting('botStatus', 'on'); const maintenance = await getSetting('maintenance', 'off');
    if (!checkAdmin(ctx) && (botStatus === 'off' || maintenance === 'on')) return; 
    await registerUser(ctx); const lang = await getLang(ctx); ctx.reply(lang === 'bn' ? `স্বাগতম, ${ctx.from.first_name}!` : `Welcome, ${ctx.from.first_name}!`, { reply_markup: getMainMenu(lang, checkAdmin(ctx)) }); 
});
bot.hears([langDB.bn.return_home, langDB.en.return_home], async (ctx) => { const lang = await getLang(ctx); ctx.reply(lang === 'bn' ? '🏠 হোম মেনু' : '🏠 Home Menu', { reply_markup: getMainMenu(lang, checkAdmin(ctx)) }); });
bot.hears([langDB.bn.menu_tasks, langDB.en.menu_tasks], showTasks); bot.hears([langDB.bn.menu_wallet, langDB.en.menu_wallet], showWallet); bot.hears([langDB.bn.menu_profile, langDB.en.menu_profile], showProfile); bot.hears([langDB.bn.menu_top, langDB.en.menu_top], showTopUsers); bot.hears([langDB.bn.menu_referral, langDB.en.menu_referral], showReferral);
bot.hears([langDB.bn.menu_lang, langDB.en.menu_lang], (ctx) => { ctx.reply('🌐 ভাষা নির্বাচন করুন / Select your language:', { reply_markup: { inline_keyboard: [[{ text: '🇧🇩 বাংলা', callback_data: 'SET_LANG_BN', style: 'primary' }, { text: '🇬🇧 English', callback_data: 'SET_LANG_EN', style: 'primary' }]] } }); });

bot.action(/VIEW_TASK_(.+)/, async (ctx) => {
    const taskStatus = await getSetting('taskStatus', 'on');
    if (taskStatus === 'off' && !checkAdmin(ctx)) return ctx.answerCbQuery('⚠️ Currently task submission is disabled.', { show_alert: true });

    const task = await Task.findById(ctx.match[1]); if (!task) return ctx.answerCbQuery('টাস্কটি পাওয়া যায়নি!');
    const lang = await getLang(ctx); const rules = task.rules || (lang === 'bn' ? 'উপরের নিয়মগুলো মেনে কাজ করুন। নিয়ম না মানলে রিপোর্ট বাতিল করা হবে ❌' : 'Follow the rules given above and work. If you do not follow the rules, the report will be rejected ❌');
    await ctx.deleteMessage().catch(()=>{}); await ctx.reply(langDB[lang].task_intro(task.name, task.price, rules), { reply_markup: { inline_keyboard: [[{ text: langDB[lang].start_btn, callback_data: `START_TASK_${task._id}`, style: 'success' }]] } });
});

bot.action(/START_TASK_(.+)/, async (ctx) => {
    const taskStatus = await getSetting('taskStatus', 'on');
    if (taskStatus === 'off' && !checkAdmin(ctx)) return ctx.answerCbQuery('⚠️ Currently task submission is disabled.', { show_alert: true });

    const task = await Task.findById(ctx.match[1]); if (!task) return ctx.answerCbQuery('টাস্কটি পাওয়া যায়নি!');
    const u = await User.findOne({ telegramId: ctx.from.id.toString() }); if(!u) return ctx.answerCbQuery('ইউজার ডাটাবেসে নেই!');
    
    let fName, lName, uName, email;
    const lowerType = task.type ? task.type.toLowerCase() : '';
    if (lowerType === 'tiktok') {
        fName = faker.person.firstName().replace(/[^a-zA-Z]/g, '');
        lName = faker.person.lastName().replace(/[^a-zA-Z]/g, '');
        uName = `${fName.toLowerCase()}${lName.toLowerCase()}${Math.floor(1000 + Math.random() * 9000)}usa`;
    } else {
        fName = faker.person.firstName().replace(/[^a-zA-Z]/g, '');
        lName = faker.person.lastName().replace(/[^a-zA-Z]/g, '');
        uName = `${fName.toLowerCase()}_${lName.toLowerCase()}${Math.floor(Math.random() * 999)}`;
    }
    email = `${uName}@gmail.com`;

    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(()=>{});
    ctx.scene.enter('TASK_WIZARD', { taskData: task, fakeUser: { firstName: fName, lastName: lName, username: uName, email: email }, userId: u._id });
});

bot.action(/WITHDRAW_(.+)/, async (ctx) => ctx.scene.enter('WITHDRAW_WIZARD', { userId: ctx.match[1] }));

// ==========================================
// ৮. Admin Panel System (Reorganized & Updated)
// ==========================================
function getAdminMenu() {
    return { inline_keyboard: [
        [{ text: '📊 Dashboard Stats', callback_data: 'ADMIN_STATS', style: 'primary' }, { text: '⚙️ Settings', callback_data: 'ADMIN_SETTINGS', style: 'primary' }],
        [{ text: '🛠️ Task Manage', callback_data: 'ADMIN_TASK_MANAGE_MENU', style: 'success' }, { text: '📋 View Tasks (Export)', callback_data: 'ADMIN_VIEW_TASKS', style: 'success' }],
        [{ text: '💸 Review Withdrawals', callback_data: 'ADMIN_PENDING_WDS', style: 'primary' }, { text: '📢 Broadcast', callback_data: 'ADMIN_BROADCAST', style: 'primary' }],
        [{ text: `👑 Admin ID: ${process.env.ADMIN_ID}`, callback_data: 'ADMIN_INFO', style: 'danger' }]
    ]};
}

bot.hears('👑 Admin Panel', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    ctx.reply('👑 **Taskesy Admin Panel**\nকী কন্ট্রোল করতে চান তা নির্বাচন করুন:', { parse_mode: 'Markdown', reply_markup: getAdminMenu() });
});

bot.action('ADMIN_INFO', (ctx) => ctx.answerCbQuery('এই বটটি আপনার দ্বারা নিয়ন্ত্রিত হচ্ছে! 👑', { show_alert: true }));
bot.action('ADMIN_MAIN', (ctx) => {
    if (!checkAdmin(ctx)) return;
    ctx.editMessageText('👑 **Taskesy Admin Panel**\nকী কন্ট্রোল করতে চান তা নির্বাচন করুন:', { parse_mode: 'Markdown', reply_markup: getAdminMenu() });
});

bot.action('ADMIN_STATS', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const users = await User.countDocuments(); const tasks = await Submission.countDocuments({ status: 'pending' }); const wds = await Withdrawal.countDocuments({ status: 'pending' });
    await ctx.editMessageText(`📊 **ড্যাশবোর্ড স্ট্যাটাস**\n━━━━━━━━━━━━━\n👥 মোট ইউজার: ${users} জন\n⏳ পেন্ডিং টাস্ক: ${tasks} টি\n💸 পেন্ডিং উইথড্র: ${wds} টি`, { parse_mode: 'Markdown', reply_markup: getAdminMenu() });
});

// Admin Settings
bot.action('ADMIN_SETTINGS', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const botStatus = await getSetting('botStatus', 'on');
    const taskStatus = await getSetting('taskStatus', 'on');
    const maintenance = await getSetting('maintenance', 'off');
    const refCommission = await getSetting('refCommission', '0');

    ctx.editMessageText('⚙️ **Bot Settings**\nক্লিক করে On/Off পরিবর্তন করুন:', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
            [{ text: `🤖 Bot Status: ${botStatus.toUpperCase()}`, callback_data: `SET_botStatus_${botStatus === 'on' ? 'off' : 'on'}`, style: botStatus === 'on' ? 'success' : 'danger' }],
            [{ text: `⚡ Task System: ${taskStatus.toUpperCase()}`, callback_data: `SET_taskStatus_${taskStatus === 'on' ? 'off' : 'on'}`, style: taskStatus === 'on' ? 'success' : 'danger' }],
            [{ text: `🚧 Maintenance: ${maintenance.toUpperCase()}`, callback_data: `SET_maintenance_${maintenance === 'on' ? 'off' : 'on'}`, style: maintenance === 'on' ? 'danger' : 'primary' }],
            [{ text: `🎁 Ref Commission: ${refCommission}%`, callback_data: 'SET_REF_COMMISSION', style: 'primary' }],
            [{ text: '🔙 Back', callback_data: 'ADMIN_MAIN', style: 'danger' }]
        ]}
    });
});

bot.action(/SET_(botStatus|taskStatus|maintenance)_(on|off)/, async (ctx) => {
    if (!checkAdmin(ctx)) return;
    await setSetting(ctx.match[1], ctx.match[2]);
    bot.handleUpdate({ callback_query: { data: 'ADMIN_SETTINGS', message: ctx.callbackQuery.message, from: ctx.from } });
});
bot.action('SET_REF_COMMISSION', (ctx) => { if (checkAdmin(ctx)) ctx.scene.enter('ADMIN_REF_COMM_WIZARD'); });

// Task Manage Menu
bot.action('ADMIN_TASK_MANAGE_MENU', (ctx) => {
    if (!checkAdmin(ctx)) return;
    ctx.editMessageText('🛠️ **Task Manage**\nকী করতে চান?', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
        [{ text: '➕ Add New Task', callback_data: 'ADMIN_TASK_ADD', style: 'success' }],
        [{ text: '📝 Manage Live Tasks', callback_data: 'ADMIN_LIVE_TASKS', style: 'primary' }],
        [{ text: '🔙 Back', callback_data: 'ADMIN_MAIN', style: 'danger' }]
    ]}});
});

bot.action('ADMIN_TASK_ADD', (ctx) => { if (checkAdmin(ctx)) ctx.scene.enter('ADMIN_ADD_TASK_WIZARD'); });

bot.action('ADMIN_LIVE_TASKS', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const tasks = await Task.find({ status: 'active' });
    if (tasks.length === 0) return ctx.answerCbQuery('কোনো লাইভ টাস্ক নেই!', { show_alert: true });
    let btns = tasks.map(t => [{ text: `⚡ ${t.name} (৳${t.price})`, callback_data: `ADMIN_EDIT_T_${t._id}` }]);
    btns.push([{ text: '🔙 Back', callback_data: 'ADMIN_TASK_MANAGE_MENU', style: 'danger' }]);
    ctx.editMessageText('📝 **এডিট বা ডিলিট করতে যেকোনো একটি লাইভ টাস্ক সিলেক্ট করুন:**', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
});

bot.action(/ADMIN_EDIT_T_(.+)/, async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const task = await Task.findById(ctx.match[1]); if (!task) return ctx.answerCbQuery('টাস্ক পাওয়া যায়নি!');
    ctx.editMessageText(`📝 **Task Manage:** ${task.name}\n💰 Price: ৳${task.price}\n🔐 Pass: \`${task.password}\``, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
        [{ text: '💰 Edit Price', callback_data: `ADMIN_ET_PRICE_${task._id}`, style: 'primary' }, { text: '🔐 Edit Pass', callback_data: `ADMIN_ET_PASS_${task._id}`, style: 'primary' }],
        [{ text: '🗑️ Delete Task', callback_data: `ADMIN_ET_DEL_${task._id}`, style: 'danger' }],
        [{ text: '🔙 Back', callback_data: 'ADMIN_LIVE_TASKS', style: 'primary' }]
    ]}});
});

bot.action(/ADMIN_ET_PRICE_(.+)/, async (ctx) => {
    if (!checkAdmin(ctx)) return; const task = await Task.findById(ctx.match[1]);
    ctx.scene.enter('ADMIN_EDIT_TASK_WIZARD', { action: 'price', task: task });
});
bot.action(/ADMIN_ET_PASS_(.+)/, async (ctx) => {
    if (!checkAdmin(ctx)) return; const task = await Task.findById(ctx.match[1]);
    ctx.scene.enter('ADMIN_EDIT_TASK_WIZARD', { action: 'pass', task: task });
});
bot.action(/ADMIN_ET_DEL_(.+)/, async (ctx) => {
    if (!checkAdmin(ctx)) return; await Task.findByIdAndDelete(ctx.match[1]);
    await ctx.answerCbQuery('টাস্কটি ডিলিট করা হয়েছে!', { show_alert: true });
    bot.handleUpdate({ callback_query: { data: 'ADMIN_LIVE_TASKS', message: ctx.callbackQuery.message, from: ctx.from } });
});

// View Tasks (Export Excel)
bot.action('ADMIN_VIEW_TASKS', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const tasks = await Task.find({ status: 'active' });
    if (tasks.length === 0) return ctx.answerCbQuery('কোনো লাইভ টাস্ক নেই!', { show_alert: true });
    let btns = tasks.map(t => [{ text: `📋 ${t.name}`, callback_data: `ADMIN_VT_${t._id}`, style: 'primary' }]);
    btns.push([{ text: '🔙 Back', callback_data: 'ADMIN_MAIN', style: 'danger' }]);
    ctx.editMessageText('📋 **কোন টাস্কের ডাটা ডাউনলোড করতে চান তা সিলেক্ট করুন:**', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
});

bot.action(/ADMIN_VT_(.+)/, async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const task = await Task.findById(ctx.match[1]); if (!task) return ctx.answerCbQuery('টাস্ক পাওয়া যায়নি!');
    ctx.editMessageText(`📋 **View Task:** ${task.name}\n\nকীভাবে ডাটা ডাউনলোড করতে চান?`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
        [{ text: '✅ Complete Today', callback_data: `ADMIN_VT_CT_${task._id}`, style: 'success' }],
        [{ text: '📥 Download Live Task', callback_data: `ADMIN_VT_ALL_${task._id}`, style: 'primary' }],
        [{ text: '🔙 Back', callback_data: 'ADMIN_VIEW_TASKS', style: 'danger' }]
    ]}});
});

async function exportTasksToExcel(ctx, taskId, completeToday) {
    const task = await Task.findById(taskId);
    if (!task) return ctx.answerCbQuery('টাস্ক পাওয়া যায়নি!');
    
    let query = { activeTaskId: taskId.toString() };
    if (completeToday) {
        let startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
        let endOfDay = new Date(); endOfDay.setHours(23,59,59,999);
        query.time = { $gte: startOfDay, $lt: endOfDay };
    }
    
    const submissions = await Submission.find(query);
    if (submissions.length === 0) return ctx.reply("⚠️ No Pending Task");

    await ctx.reply("⏳ এক্সেল ফাইল তৈরি হচ্ছে, দয়া করে অপেক্ষা করুন...");
    let exportData = [];
    let isFB = ['fb', 'facebook'].includes(task.type.toLowerCase());
    
    for (let sub of submissions) {
        let row = {};
        if (isFB) row['UID'] = sub.fbUid || 'N/A';
        else row['Username'] = sub.username || sub.generatedEmail || 'N/A';
        
        row['Password'] = sub.password || 'N/A';
        if (task.is2FA) row['2FA'] = sub.secret2fa || 'N/A';
        if (task.isCookie) row['Cookies'] = sub.cookie || 'N/A';
        row['Task ID'] = sub.taskId;
        
        exportData.push(row);
    }
    
    const ws = xlsx.utils.json_to_sheet(exportData);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Tasks");
    const buffer = Buffer.from(xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    
    let fileName = completeToday ? `Today_${task.name.replace(/\s+/g, '_')}.xlsx` : `All_${task.name.replace(/\s+/g, '_')}.xlsx`;
    await ctx.replyWithDocument({ source: buffer, filename: fileName }, { caption: `✅ **${task.name}** এর মোট ${submissions.length} টি ডাটা এক্সপোর্ট করা হয়েছে।\n(Google Sheet বা Excel অ্যাপ দিয়ে ফাইলটি ওপেন করুন)`, parse_mode: 'Markdown' });
}

bot.action(/ADMIN_VT_CT_(.+)/, async (ctx) => {
    if (!checkAdmin(ctx)) return; await ctx.answerCbQuery();
    await exportTasksToExcel(ctx, ctx.match[1], true);
});

bot.action(/ADMIN_VT_ALL_(.+)/, async (ctx) => {
    if (!checkAdmin(ctx)) return; await ctx.answerCbQuery();
    await exportTasksToExcel(ctx, ctx.match[1], false);
});

// Admin Withdrawal Review
bot.action('ADMIN_PENDING_WDS', async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const wd = await Withdrawal.findOne({ status: 'pending' }).populate('uid');
    if (!wd) return ctx.editMessageText('✅ এই মুহূর্তে কোনো পেন্ডিং উইথড্র নেই!', { reply_markup: getAdminMenu() });
    
    let text = `💸 **Withdrawal Review**\n━━━━━━━━━━━━━\n👤 **Name:** ${wd.name}\n💰 **Amount:** ৳${wd.amount}\n🎁 **Net Payable:** ৳${wd.netAmount}\n\n💳 **Method:** ${wd.method.toUpperCase()}\n🏦 **Account:** \`${wd.account}\``;
    
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
        [{ text: '✅ Mark as Paid', callback_data: `ADMIN_APP_WD_${wd._id}`, style: 'success' }, { text: '❌ Reject & Refund', callback_data: `ADMIN_REJ_WD_${wd._id}`, style: 'danger' }],
        [{ text: '🔙 Back', callback_data: 'ADMIN_MAIN', style: 'primary' }]
    ]}});
});

bot.action(/ADMIN_APP_WD_(.+)/, async (ctx) => {
    if (!checkAdmin(ctx)) return; const wd = await Withdrawal.findById(ctx.match[1]);
    if (wd && wd.status === 'pending') { await Withdrawal.findByIdAndUpdate(wd._id, { status: 'approved' }); await User.findByIdAndUpdate(wd.uid, { withdrawStatus: 'Completed' }); await ctx.answerCbQuery('পেমেন্ট সাকসেস করা হয়েছে!'); }
    bot.handleUpdate({ callback_query: { data: 'ADMIN_PENDING_WDS', message: ctx.callbackQuery.message, from: ctx.from } });
});

bot.action(/ADMIN_REJ_WD_(.+)/, async (ctx) => {
    if (!checkAdmin(ctx)) return; const wd = await Withdrawal.findById(ctx.match[1]);
    if (wd && wd.status === 'pending') { await Withdrawal.findByIdAndUpdate(wd._id, { status: 'rejected' }); await User.findByIdAndUpdate(wd.uid, { $inc: { earned: wd.amount }, withdrawStatus: 'Refunded' }); await ctx.answerCbQuery('উইথড্র বাতিল এবং রিফান্ড করা হয়েছে!'); }
    bot.handleUpdate({ callback_query: { data: 'ADMIN_PENDING_WDS', message: ctx.callbackQuery.message, from: ctx.from } });
});

bot.action('ADMIN_BROADCAST', (ctx) => { if (checkAdmin(ctx)) ctx.scene.enter('ADMIN_BROADCAST_WIZARD'); });

// ==========================================
// ৯. Real-Time Notifications & Ref Commission
// ==========================================
setInterval(async () => {
    try {
        const submissions = await Submission.find({ status: { $in: ['approved', 'rejected'] }, tgNotified: false }).populate('uid');
        const refCommStr = await getSetting('refCommission', '0');
        const commissionPct = parseFloat(refCommStr);

        for (const sub of submissions) {
            if (sub.status === 'approved' && sub.uid && sub.uid.referrerId) {
                if (commissionPct > 0) {
                    const commAmount = (sub.price * commissionPct) / 100;
                    await User.findByIdAndUpdate(sub.uid.referrerId, { $inc: { earned: commAmount, refEarn: commAmount } });
                }
            }

            if (sub.uid && sub.uid.telegramId) {
                const lang = sub.uid.language || 'bn';
                let msg = sub.status === 'approved' ? (lang === 'bn' ? `✅ **টাস্ক অপ্প্রভড!**\nআপনার টাস্কটি (ID: \`${sub.taskId}\`) সফলভাবে গ্রহণ করা হয়েছে।\n💰 আপনার ব্যালেন্সে **৳${sub.price}** অ্যাড হয়েছে।` : `✅ **Task Approved!**\nYour task (ID: \`${sub.taskId}\`) was accepted.\n💰 **৳${sub.price}** added to your balance.`) : (lang === 'bn' ? `❌ **টাস্ক রিজেক্টেড!**\nআপনার সাবমিট করা টাস্কটি (ID: \`${sub.taskId}\`) বাতিল করা হয়েছে।\n\n🆔 **Username / Email:** \`${sub.username || sub.generatedEmail}\`\n⚠️ **কারণ:** Rejected for Blocked / Invalid Data.` : `❌ **Task Rejected!**\nYour submitted task (ID: \`${sub.taskId}\`) was declined.\n\n🆔 **Username / Email:** \`${sub.username || sub.generatedEmail}\`\n⚠️ **Reason:** Rejected for Blocked / Invalid Data.`);
                await bot.telegram.sendMessage(sub.uid.telegramId, msg, { parse_mode: 'Markdown' }).catch(()=>{}); await Submission.findByIdAndUpdate(sub._id, { tgNotified: true });
            }
        }
        const withdrawals = await Withdrawal.find({ status: { $in: ['approved', 'rejected'] }, tgNotified: false }).populate('uid');
        for (const w of withdrawals) {
            if (w.uid && w.uid.telegramId) {
                const lang = w.uid.language || 'bn';
                let msg = w.status === 'approved' ? (lang === 'bn' ? `🎉 **পেমেন্ট কমপ্লিট!**\nআপনার ৳${w.amount} উইথড্র রিকোয়েস্টটি অপ্প্রভ করা হয়েছে এবং আপনার ${w.method.toUpperCase()} নাম্বারে পেমেন্ট পাঠানো হয়েছে।\n\nধন্যবাদ Taskesy এর সাথে থাকার জন্য!` : `🎉 **Payment Complete!**\nYour ৳${w.amount} withdrawal request has been approved and sent to your ${w.method.toUpperCase()} number.\n\nThank you for staying with Taskesy!`) : (lang === 'bn' ? `⚠️ **উইথড্র রিজেক্টেড!**\nআপনার ৳${w.amount} উইথড্র রিকোয়েস্টটি এডমিন বাতিল করেছেন এবং এমাউন্টটি আপনার ব্যালেন্সে রিফান্ড করা হয়েছে।\n\nদয়া করে সঠিক একাউন্ট ডিটেইলস দিয়ে পুনরায় রিকোয়েস্ট দিন।` : `⚠️ **Withdrawal Rejected!**\nYour ৳${w.amount} withdrawal request was cancelled by the admin and refunded to your balance.\n\nPlease request again with correct account details.`);
                await bot.telegram.sendMessage(w.uid.telegramId, msg, { parse_mode: 'Markdown' }).catch(()=>{}); await Withdrawal.findByIdAndUpdate(w._id, { tgNotified: true });
            }
        }
    } catch (e) { console.error("Notification Polling Error:", e); }
}, 10000);

const app = express(); app.get('/', (req, res) => res.send('Taskesy PRO Bot is Active!')); app.listen(process.env.PORT || 3000, () => console.log(`Server listening on port ${process.env.PORT || 3000}!`));
bot.launch().then(() => console.log('Taskesy PRO Bot is Running with Updated Admin Panel!')); process.once('SIGINT', () => bot.stop('SIGINT')); process.once('SIGTERM', () => bot.stop('SIGTERM'));
