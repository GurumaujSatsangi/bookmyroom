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
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
    socket: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
    }
});

client.on('error', err => console.log('Redis Client Error', err));

await client.connect();




app.get("/",async(req,res)=>{

    const {data,error} = await supabase.from("hostels").select("*");

    res.render("home.ejs",{hostels:data});
})

app.get("/hostel/:id", async (req, res) => {
  try {
    // 1. Fetch data and handle database errors immediately
    const { data: rooms, error } = await supabase
      .from("rooms")
      .select("*")
      .eq("hostel_id", req.params.id);

    if (error || !rooms) {
      console.error("Database error:", error);
      return res.status(500).send("Error fetching hostel data");
    }

    // 2. Efficiently filter locked rooms without creating array holes
    const locked_rooms = [];
    for (let i = 0; i < rooms.length; i++) {
      const isCached = await client.get(rooms[i].room_number);
      console.log(isCached);
      if (isCached) {
        locked_rooms.push(rooms[i].room_number);
      }
    }

    // 3. Render the page with safe data
    return res.render("hostel.ejs", { rooms, locked_rooms });

  } catch (err) {
    console.error("Server crash prevented:", err);
    return res.status(500).send("Internal Server Error");
  }
});

app.get("/confirmation/:id", async (req, res) => {
  const room_number = req.params.id;
  
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("room_number", room_number)
    .single();

  if (error || !data) {
    return res.status(404).send("Room not found");
  }

  // Creates an empty array based on the occupancy number
  const loopArray = Array.from({ length: data.occupancy });

  return res.render("confirm-registration.ejs", { 
    room_number, 
    data: loopArray 
  });
});



app.post("/select-room/:room_number",async(req,res)=>{
    const room_number = req.params.room_number;
    await client.set(room_number,"23BCE0474",{EX:1800});
    console.log("Room Number "+room_number+" has been Locked for 60 seconds!");
    return res.redirect("/confirmation/"+room_number);
})

app.listen("3030",()=>{
    console.log("server running on port 3030!");
})