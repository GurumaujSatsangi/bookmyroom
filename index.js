import express from 'express';
import session from 'express-session';


const app = express();

app.get("/",async(req,res)=>{
    res.render("home.ejs");
})

app.listen("3030",()=>{
    console.log("server running on port 3030!");
})