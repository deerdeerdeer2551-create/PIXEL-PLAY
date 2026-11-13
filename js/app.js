const CATEGORIES = [
  ["ของใช้ภายในบ้าน","เช่น กระจก, เก้าอี้"],
  ["ของกิน","เช่น กุ้งทอด, กล้วย"],
  ["ของใช้ส่วนตัว","เช่น กางเกง, กระเป๋า"],
  ["สัตว์","เช่น กบ, กวาง"],
  ["อาชีพ","เช่น กุ๊ก, ครู"]
];
let currentCategories = CATEGORIES.map(item => [...item]);
const LETTERS = ["ก","ข","ค","ง","จ","ช","ซ","ด","ต","ถ","ท","น","บ","ป","ผ","พ","ฟ","ม","ย","ร","ล","ว","ส","ห","อ"];
let letter = "ก", seconds = 60, score = 0, correct = 0, timerId = null, round = 1;
const $ = id => document.getElementById(id);
const normalize = s => s.trim().replace(/\s+/g,"").replace(/[่-๋์]/g,"");
const startsWithLetter = (word, initial) => normalize(word).replace(/^[เแโใไ]/,"").startsWith(initial);
function renderCategories(){
  $("categories").innerHTML = currentCategories.map((c,i)=>`<div class="category"><label>${i+1}. ${c[0]}</label><input id="answer-${i}" maxlength="40" placeholder="${c[1]}"></div>`).join("");
}
async function setLetter(){
  letter = LETTERS[Math.floor(Math.random()*LETTERS.length)];
  $("letter").textContent = letter;
  const stageLetter = $("stage-letter");
  if(stageLetter) stageLetter.textContent = letter;
  try {
    const response = await fetch(`/api/round/${encodeURIComponent(letter)}`);
    if (response.ok) {
      const data = await response.json();
      if (!data.ready || !Array.isArray(data.categories) || data.categories.length !== 5) {
        throw new Error("ยังจัดหมวดหมู่ให้ครบไม่ได้");
      }
      currentCategories = data.categories.map((item, i) => [
        item.name,
        `ตัวอย่างคำตอบ: ${item.suggestion}`,
        item.suggestion
      ]);
    } else {
      currentCategories = CATEGORIES.map(item => [...item]);
    }
  } catch (error) {
    currentCategories = CATEGORIES.map(item => [...item]);
  }
  renderCategories();
}
function startTimer(){
  clearInterval(timerId); seconds=60; $("timer").textContent=seconds;
  timerId=setInterval(()=>{seconds--; $("timer").textContent=seconds;if(seconds<=0){clearInterval(timerId);$("feedback").textContent="หมดเวลาแล้ว! กดเริ่มใหม่เพื่อเล่นอีกครั้ง";$("submit").disabled=true;}},1000);
}
function newRound(){
  $("result-panel").classList.add("hidden");
  $("solo-panel").classList.remove("hidden");
  round++; $("round").textContent=String(round).padStart(2,"0");
  setLetter(); $("feedback").textContent="กำลังจัดหมวดหมู่ให้ตรงกับตัวอักษรที่สุ่ม...";
  $("submit").disabled=false; startTimer();
}
const SAMPLE_ANSWERS = {
  "ของใช้ภายในบ้าน": ["กระจก", "เก้าอี้", "กุญแจ", "กรอบรูป"],
  "ของกิน": ["กล้วย", "กุ้งทอด", "แกงจืด", "ก๋วยเตี๋ยว"],
  "ของใช้ส่วนตัว": ["กางเกง", "กระเป๋า", "กำไล", "กิ๊บติดผม"],
  "สัตว์": ["กบ", "กวาง", "ไก่", "กุ้ง"],
  "อาชีพ": ["กุ๊ก", "กรรมกร", "กัปตัน", "เกษตรกร"]
};
const EXTRA_ANSWER_KEY = {
  "ของใช้ภายในบ้าน": {"ร":"ราวตากผ้า"},
  "ของกิน": {"ร":"ราดหน้า"},
  "ของใช้ส่วนตัว": {"ร":"รองเท้า"},
  "สัตว์": {"ร":"ราชสีห์"},
  "อาชีพ": {"ร":"ไรเดอร์"}
};
function exampleAnswer(category){
  const current = currentCategories.find(item => item[0] === category);
  if (current && current[2]) return current[2];
  const special = EXTRA_ANSWER_KEY[category]?.[letter];
  if(special) return special;
  const options = SAMPLE_ANSWERS[category] || [];
  return options.find(word => startsWithLetter(word, letter)) || "ไม่มีคำเฉลยในรอบนี้";
}
function showResults(results, aiReady){
  const right = results.filter(r=>r.valid).length;
  const wrong = results.length-right;
  const points = right*10;
  score += points; correct=right;
  $("score").textContent=score;
  $("correct").textContent=`${right} / 5`;
  const best=Math.max(score,Number(localStorage.getItem("pixelBest")||0));
  localStorage.setItem("pixelBest",best); $("best").textContent=best;

  $("result-correct").textContent=right;
  $("result-wrong").textContent=wrong;
  $("result-points").textContent=points;
  $("result-list").innerHTML=results.map((r,i)=>{
    const sample = r.suggestion || exampleAnswer(r.category);
    const submitted = r.answer ? escapeHtml(r.answer) : "ไม่ได้ตอบ";
    const reason = escapeHtml(r.reason || (r.valid ? "คำตอบถูกต้อง" : "คำตอบไม่ถูกต้อง"));
    const sourceLabel = r.source === "dictionary" ? "ฐานข้อมูล" : r.source === "ai" ? "AI" : r.source === "rule" ? "ตรวจตัวอักษร" : "";
    const answerLine = r.valid
      ? `<p><b>คำตอบของคุณ:</b> ${submitted}</p>`
      : `<p><b>คำตอบของคุณ:</b> ${submitted}</p><p><b>ตัวอย่างเฉลย:</b> ${escapeHtml(sample)}</p>`;
    return `<article class="result-item ${r.valid?"correct":"wrong"}"><div><h3>${i+1}. ${escapeHtml(r.category)}</h3>${answerLine}<p>${reason}${sourceLabel ? " · ตรวจด้วย: "+sourceLabel : ""}</p></div><span class="result-status">${r.valid?"ถูกต้อง +10":"ตอบผิด"}</span></article>`;
  }).join("");
  $("result-note").textContent = aiReady
    ? "ระบบตรวจฐานข้อมูลคำศัพท์ก่อน และใช้ AI ช่วยตรวจคำที่ไม่พบในฐานข้อมูล ช่องว่าง คำที่อ่านไม่ชัด หรือคำที่ยืนยันไม่ได้ จะนับเป็นคำตอบผิด"
    : "ระบบเลือกหมวดหมู่ให้ตรงกับตัวอักษรที่สุ่ม หากหมวดของใช้ภายในบ้านไม่มีคำที่ตรง ระบบจะเปลี่ยนเป็นของใช้ในชีวิตประจำวันโดยอัตโนมัติ";
  $("solo-panel").classList.add("hidden");
  $("result-panel").classList.remove("hidden");
  clearInterval(timerId);
}
function escapeHtml(value){
  return String(value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
async function submitAnswers(){
  $("submit").disabled=true;
  $("feedback").textContent="กำลังตรวจคำตอบทั้ง 5 หมวด...";
  const answers=currentCategories.map((c,i)=>({category:c[0],answer:$("answer-"+i).value.trim()}));
  const results=[];
  let aiReady=false;
  for(const item of answers){
    if(!item.answer){
      results.push({...item,valid:false,suggestion:exampleAnswer(item.category),reason:"ไม่ได้กรอกคำตอบ จึงนับเป็นคำตอบผิด"});
      continue;
    }
    if(!startsWithLetter(item.answer,letter)){
      results.push({...item,valid:false,reason:`คำตอบต้องขึ้นต้นด้วย ${letter}`});
      continue;
    }
    try{
      const response=await fetch("/api/validate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({letter,category:item.category,answer:item.answer})});
      const result=await response.json();
      if(result.source==="ai") aiReady=true;
      if(result.valid===true){
        results.push({...item,valid:true,source:result.source,reason:result.reason||"ผ่านการตรวจสอบ",suggestion:result.suggestion||null});
      }else{
        results.push({...item,valid:false,source:result.source,reason:result.reason||"ระบบอ่านหรือยืนยันคำตอบไม่ได้ จึงนับเป็นคำตอบผิด",suggestion:result.suggestion||null});
      }
    }catch(e){
      aiReady=false;
      results.push({...item,valid:false,reason:"ระบบตรวจคำตอบขัดข้องหรืออ่านคำตอบไม่ได้ จึงนับเป็นคำตอบผิด"});
    }
  }
  showResults(results,aiReady);
}

function enterMode(mode){
  $("home-panel").classList.add("hidden");
  $("solo-panel").classList.toggle("hidden",mode!=="solo");
  $("online-panel").classList.toggle("hidden",mode!=="online");
  $("back-home").classList.remove("hidden");
  $("how").classList.add("hidden");
  $("about").classList.add("hidden");
  document.querySelector(".game-intro").classList.remove("hidden");
  if(mode==="online"){
    $("online-panel").classList.remove("hidden");
    $("solo-panel").classList.add("hidden");
    clearInterval(timerId);
  } else {
    startTimer();
  }
}
$("home-solo").addEventListener("click",()=>enterMode("solo"));
$("home-online").addEventListener("click",()=>enterMode("online"));
$("back-home").addEventListener("click",()=>{
  $("home-panel").classList.remove("hidden");
  $("solo-panel").classList.add("hidden");
  $("online-panel").classList.add("hidden");
  $("back-home").classList.add("hidden");
  $("how").classList.remove("hidden");
  $("about").classList.remove("hidden");
  document.querySelector(".game-intro").classList.add("hidden");
});
document.querySelectorAll(".mode").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".mode").forEach(b=>b.classList.toggle("active",b===btn));
  const online=btn.dataset.mode==="online";
  $("solo-panel").classList.toggle("hidden",online); $("online-panel").classList.toggle("hidden",!online);
}));
$("new-round").addEventListener("click",newRound);
$("reset").addEventListener("click",()=>{score=0;correct=0;$("score").textContent="0";$("correct").textContent="0 / 5";newRound();});
$("submit").addEventListener("click",submitAnswers);
$("play-again").addEventListener("click",()=>{
  $("result-panel").classList.add("hidden");
  $("solo-panel").classList.remove("hidden");
  newRound();
});
$("result-home").addEventListener("click",()=>{
  $("result-panel").classList.add("hidden");
  $("home-panel").classList.remove("hidden");
  $("back-home").classList.add("hidden");
  $("how").classList.remove("hidden");
  $("about").classList.remove("hidden");
  document.querySelector(".game-intro").classList.add("hidden");
});

$("best").textContent=localStorage.getItem("pixelBest")||"0";
setLetter();
// Timer begins only after the player selects "เล่นคนเดียว".


// Multiplayer room shell. Server broadcasts room events; live synchronized rounds are a next development milestone.
const socket = window.io ? io() : null;
if(socket){
  socket.on("connect",()=>$("online-status").textContent="สถานะ: เชื่อมต่อเซิร์ฟเวอร์แล้ว");
  socket.on("room-created",data=>showRoom(data));
  socket.on("room-joined",data=>showRoom(data));
  socket.on("room-update",data=>showRoom(data));
  socket.on("room-error",msg=>$("online-status").textContent="ไม่สำเร็จ: "+msg);
}
function showRoom(data){
  $("room-info").classList.remove("hidden");
  $("room-info").innerHTML=`<b>รหัสห้อง: ${data.code}</b><p>ผู้เล่น: ${(data.players||[]).map(p=>p.name).join(", ")}</p><p>แชร์รหัสนี้ให้เพื่อนเพื่อเข้าร่วม</p>`;
  $("online-status").textContent="สถานะ: อยู่ในห้อง "+data.code;
}
$("create-room").addEventListener("click",()=>{
  if(!socket)return;
  socket.emit("create-room",{name:$("player-name").value.trim()||"ผู้เล่น"});
});
$("join-room").addEventListener("click",()=>{
  if(!socket)return;
  socket.emit("join-room",{name:$("player-name").value.trim()||"ผู้เล่น",code:$("room-code").value.trim().toUpperCase()});
});
