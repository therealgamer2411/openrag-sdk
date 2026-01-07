const OpenRAG = require('./index');

// إعداد العميل (تذكر وضع رابط سيرفرك الحقيقي)
const client = new OpenRAG({ 
    apiKey: 'sk_live_TEST_KEY',
    serverUrl: 'https://openrag-grid.koyeb.app/' 
});

(async () => {
    try {
        // 1. الاتصال
        await client.connect();

        // 2. طلب موقع لمعرفة الـ IP (للتأكد أنه IP سكني)
        console.log("🔍 جاري جلب البيانات...");
        const data = await client.fetch('https://api.ipify.org?format=json');
        
        console.log("\n📦 الرد من الشبكة:");
        console.log(data);

    } catch (err) {
        console.error("💥 خطأ:", err.message);
    } finally {
        client.disconnect();
    }
})();
