const button=document.querySelector('#verify'),status=document.querySelector('#status');
const token=new URL(location.href).searchParams.get('token');
if(!token||!/^[a-f0-9]{64}$/.test(token)){button.disabled=true;status.textContent='ลิงก์ไม่ถูกต้อง';}
button.addEventListener('click',async()=>{
  button.disabled=true;status.textContent='กำลังยืนยัน…';
  try{
    const response=await fetch('/api/email/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'ยืนยันไม่สำเร็จ');
    history.replaceState(null,'','/verify-email.html');status.textContent='ยืนยันอีเมลสำเร็จแล้ว กลับไปใช้ StockLens ได้';
  }catch(error){status.textContent=error.message;button.disabled=false;}
});
