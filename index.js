import express from 'express';
import session from 'express-session';
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv';

dotenv.config();

const app = express();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_PUBLISHABLE_KEY
)

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

    console.log("Room Number "+room_number+" has been Locked for 60 seconds!");

    return res.send("CONFIRM REGISTRATION");
})

app.listen("3030",()=>{
    console.log("server running on port 3030!");
})