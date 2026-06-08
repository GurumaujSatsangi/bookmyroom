import express from 'express';
import session from 'express-session';
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import dotenv from 'dotenv';
import { createClient } from "redis";
import neo4j from 'neo4j-driver';


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


  // URI examples: 'neo4j://localhost', 'neo4j+s://xxx.databases.neo4j.io'
  const URI = process.env.NEO4J_URI
  const USER = process.env.NEO4J_USERNAME
  const PASSWORD = process.env.NEO4J_PASSWORD
  const driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD))


client.on('error', err => console.log('Redis Client Error', err));

await client.connect();


app.get("/roommates",async(req,res)=>{

  return res.render("add-friends.ejs");

})

app.post("/add-friend",async(req,res)=>{
  const registration_number = '23BCE0474';
  const friend_registration_number = '23BDS0081';
  const session = driver.session();

  try {
    // 3. The Cypher Query (Parameterized for security)
    const query = `
      MATCH (sender:User {username: $sender})
      MATCH (target:User {username: $target})
      
      WHERE count { (sender)-[:FRIENDS_WITH]-() } = 0
      
      // Create the request
      MERGE (sender)-[req:REQUESTS_TO_FOLLOW]->(target)
      ON CREATE SET req.timestamp = datetime()
      
      RETURN req
    `;

    const result = await session.run(query, {
      sender: registration_number,
      target: friend_registration_number
    });

    // 4. Handle the Database Response
    if (result.records.length === 0) {
      // The WHERE clause failed, meaning the sender already has a friend, 
      // or one of the users doesn't exist in the database.
      return res.status(403).json({ 
        error: "Cannot send request. You either already have a friend or the user does not exist." 
      });
    }

    // Success!
    return res.status(200).json({ 
      message: `Friend request sent to ${friend_registration_number}!` 
    });

  } catch (error) {
    console.error("Database error:", error);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    // Always close the session to free up database connections
    await session.close();
  }


  
})

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
  
  try {
    // 1. Fetch Room Data from Supabase
    const { data, error } = await supabase
      .from("rooms")
      .select("*")
      .eq("room_number", room_number)
      .single();

    if (error || !data) {
      return res.status(404).send("Room not found");
    }

    // 2. Fetch Friends from Neo4j
    const session = driver.session();
    let friends = [];

    try {
      // I added ALIASES (AS username, AS profilePic) to make data extraction easier,
      // and parameterized the username string to follow Neo4j best practices.
      const query = `
        MATCH (u:User {username: $username})-[:FRIENDS_WITH]-(friend:User)
        RETURN friend.username AS username, friend.profilePic AS profilePic
      `;
      
      const result = await session.run(query, { username: '23BCE0474' });

      // Clean the raw Neo4j result into a standard JavaScript array of objects
      friends = result.records.map(record => ({
        username: record.get('username'),
        profilePic: record.get('profilePic')
      }));

    } finally {
      // CRITICAL: Always close the session to prevent memory leaks and crashes
      await session.close();
    }

    // 3. Prepare Data for EJS
    // Creates an empty array based on the occupancy number
    const loopArray = Array.from({ length: data.occupancy });

    return res.render("confirm-registration.ejs", { 
      room_number, 
      data: loopArray,
      friends: friends // Pass the clean array instead of the raw result
    });

  } catch (serverError) {
    // Catch any unexpected errors (e.g., Neo4j goes down)
    console.error("Confirmation Route Error:", serverError);
    return res.status(500).send("Internal Server Error");
  }
});



app.post("/select-room/:room_number",async(req,res)=>{
    const room_number = req.params.room_number;
    await client.set(room_number,"23BCE0474",{EX:300});
    console.log("Room Number "+room_number+" has been Locked for 5 minutes!");
    return res.redirect("/confirmation/"+room_number);
})

app.listen("3030",()=>{
    console.log("server running on port 3030!");
})