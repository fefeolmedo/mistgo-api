const express=require('express');const app=express();const PORT=process.env.PORT||8080;app.get('/health',(_,res)=>res.json({ok:"ci-cd-test"}));app.listen(PORT,()=>console.log('API on :'+PORT));
