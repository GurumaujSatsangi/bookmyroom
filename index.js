import express from 'express';
import session from 'express-session';
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import dotenv from 'dotenv';
import { createClient } from "redis";


dotenv.config();

const app = express();

const supabase = createSupabaseClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_PUBLISHABLE_KEY
)

const client = createClient({
    username: 'default',
    password: 'RaRqOsspCJRUK1ugVwHGrGr85VZL9sYq',
    socket: {
        host: 'deep-supermodern-smoothtoned-15476.db.redis.io',
        port: 13120
    }
});

client.on('error', err => console.log('Redis Client Error', err));

await client.connect();




app.get("/",async(req,res)=>{

    const {data,error} = await supabase.from("hostels").select("*");

    res.render("home.ejs",{hostels:data});
})

app.get("/hostel/:id",async(req,res)=>{
    const {data,error} = await supabase.from("rooms").select("*").eq("hostel_id",req.params.id);
    return res.render("hostel.ejs",{rooms:data});
})

app.post("/select-room/:room_number",async(req,res)=>{
    const room_number = req.params.room_number;
    await client.set(room_number,"23BCE0474",{EX:60});
    console.log("Room Number "+room_number+" has been Locked for 60 seconds!");
    return res.send("CONFIRM REGISTRATION");
})

app.listen("3030",()=>{
    console.log("server running on port 3030!");
})