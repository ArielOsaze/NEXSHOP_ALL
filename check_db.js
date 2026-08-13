const supabase = require('./nexshop-backend/config/db');

async function checkData() {
    const { data: settings, error: err1 } = await supabase.from('store_settings').select('*');
    const { data: music, error: err2 } = await supabase.from('music_player').select('*');
    console.log("Settings:", settings, err1);
    console.log("Music:", music, err2);
}

checkData();
