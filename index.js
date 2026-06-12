import express from 'express';
import session from 'express-session';
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import dotenv from 'dotenv';
import { createClient } from "redis";
import neo4j from 'neo4j-driver';
import bodyParser from 'body-parser';
import AWS from 'aws-sdk';



dotenv.config();

const app = express();
app.use(bodyParser.json()); 
app.use(bodyParser.urlencoded({ extended: true }));

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

app.post("/send", async (req, res) => {
  // Check if req.body exists before destructuring
  if (!req.body || !req.body.application_id) {
    return res.status(400).send("Error: Missing application_id in request body");
  }

  const { application_id } = req.body;

  try {
    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .eq("id", application_id)
      .single();

    if (error || !data) {
      return res.status(404).send("Application not found");
    }

    return res.send(data.application_name + " - " + data.application_status);
  } catch (err) {
    return res.status(500).send("Internal server error");
  }
});



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


    const message = req.query.message;
    const {data,error} = await supabase.from("hostels").select("*");

    res.render("home.ejs",{hostels:data,message:null || message});
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

    const room_number_and_ttl = new Map([]);


    for (let i = 0; i < rooms.length; i++) {
      const isCached = await client.get(rooms[i].room_number);
      console.log(isCached);
      if (isCached) {
        const ttl = await client.ttl(rooms[i].room_number)
        room_number_and_ttl.set(rooms[i].room_number,ttl)
      }
    }

    // 3. Render the page with safe data
    return res.render("hostel.ejs", { rooms, room_number_and_ttl});

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
      .eq("room_number", room_number).neq("status","OCCUPIED")
      .single();

    if (error || !data) {
      return res.status(404).send("ROOM NOT FOUND OR ROOM ALREADY OCCUPIED!");
    }

    const loopArray = Array.from({ length: data.occupancy });

    return res.render("confirmation.ejs", { 
      room_number, 
      data: loopArray,
    });

  } catch (serverError) {
    // Catch any unexpected errors (e.g., Neo4j goes down)
    return res.status(500).send("Internal Server Error");
  }
});

AWS.config.update({ region: "ap-south-1" });
var sqs = new AWS.SQS({ apiVersion: "2012-11-05" });

// This function should run in the background, independently of your API routes
async function processBookingQueue() {
  const params = {
    AttributeNames: ["SentTimestamp"],
    MaxNumberOfMessages: 1, // Process one at a time to be safe with DB updates
    MessageAttributeNames: ["All"],
    QueueUrl: "https://sqs.ap-south-1.amazonaws.com/281851731848/bookmyroom-queue.fifo",
    VisibilityTimeout: 20,
    WaitTimeSeconds: 5, // Long polling
  };

  try {
    const data = await sqs.receiveMessage(params).promise();

    if (data.Messages && data.Messages.length > 0) {
      const message = data.Messages[0];
      
      // 1. Extract the room number from the SQS MESSAGE, not req.params!
      const room_number_from_sqs = message.MessageAttributes.RoomNumber.StringValue;

      // 2. Update Supabase using the queue data
      const { data: supaData, error } = await supabase
        .from("rooms")
        .update({ status: "OCCUPIED" })
        .eq("room_number", room_number_from_sqs)
        .select();

      const {data:bookingData,error:bookingError} = await supabase.from("bookings").insert("")

      if (supaData) {
        // 3. Clear cache
        client.del(room_number_from_sqs);

        // 4. Delete the message from SQS only after successful DB update
        await sqs.deleteMessage({
          QueueUrl: "https://sqs.ap-south-1.amazonaws.com/281851731848/bookmyroom-queue.fifo",
          ReceiptHandle: message.ReceiptHandle,
        }).promise();
        
        console.log(`Successfully processed booking for room ${room_number_from_sqs}`);
      }
    }
  } catch (err) {
    console.error("Queue Processing Error:", err);
  }
}


app.post("/api/book-room/:roomnumber", async (req, res) => {
  const room_number = req.params.roomnumber;

  const params = {
    MessageAttributes: {
      RoomNumber: {
        DataType: "String",
        StringValue: room_number,
      }
    },
    MessageBody: "ROOM BOOKED!",
    MessageDeduplicationId: room_number, 
    MessageGroupId: room_number, // Better to use a static group for chronological processing
    QueueUrl: "https://sqs.ap-south-1.amazonaws.com/281851731848/bookmyroom-queue.fifo"
  };

  try {
    // Note: Using .promise() assumes AWS SDK v2 to work with async/await
    await sqs.sendMessage(params).promise(); 
    
    // Respond immediately! The actual booking happens in the background.
    return res.redirect("/?message=BOOKING REQUEST RECEIVED!");
  } catch (err) {
    console.error("SQS Send Error:", err);
    return res.status(500).send("Error queuing booking request");
  }
});




// Example of running it constantly in your Node server:
setInterval(processBookingQueue, 5000);



app.post("/select-room/:room_number",async(req,res)=>{
    const room_number = req.params.room_number;
    await client.set(room_number,"23BCE0474",{EX:300});
    console.log("Room Number "+room_number+" has been Locked for 5 minutes!");
    return res.redirect("/confirmation/"+room_number);
})

app.listen("3030",()=>{
    console.log("server running on port 3030!");
})