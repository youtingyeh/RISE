import { JSDOM } from 'jsdom';
import fs from 'node:fs';
const code=fs.readFileSync('../../auth.js','utf8').replace('  init();', '  window.test={renderPublic,teacherPage,adminPage,questionPage,set(c,u,p){client=c;user=u;profile=p;}};');
function page(name,role,application=null){
 const dom=new JSDOM(`<body data-auth-page="${name}"><div id="auth-root"></div><p id="auth-status"></p><div id="auth-notice"></div></body>`,{url:'https://youtingyeh.github.io/RISE/'+name+'.html',runScripts:'outside-only'});
 const u={id:'00000000-0000-0000-0000-000000000001',email:'test@example.org',email_confirmed_at:'now'};
 const p={id:u.id,role,requested_kind:'ta',display_name:'Test'};
 const c={auth:{getUser:async()=>({data:{user:u}})},from(table){const q={select(){return q},eq(){return q},order(){return q},single:async()=>({data:p}),maybeSingle:async()=>({data:application}),range:async()=>({data:table==='rise_teacher_applications'&&application?[application]:[]})};return q;}};
 dom.window.eval(code);dom.window.test.set(c,u,p);return dom;
}
let d=page('register','student');d.window.test.renderPublic();if(!d.window.document.querySelector('input[value=ta]'))throw Error('TA radio missing');d.window.close();
d=page('teacher','student');await d.window.test.teacherPage();if(d.window.document.querySelector('#requested-role').value!=='ta'||!d.window.document.querySelector('input[type=file]'))throw Error('application missing');d.window.close();
d=page('admin','admin',{id:'abc',applicant_name:'<img src=x>',status:'pending',requested_role:'ta',subject:'math',attachments:[{name:'proof.pdf',path:'x'}],version:1});await d.window.test.adminPage();if(d.window.document.querySelector('#review-list img')||!d.window.document.querySelector('#evidence-abc button'))throw Error('review unsafe or missing evidence');d.window.close();
d=page('questions','ta');await d.window.test.questionPage();if(!d.window.document.querySelector('#question-form')||!d.window.document.body.textContent.includes('學生問答工作台'))throw Error('QA missing');d.window.close();
console.log('PASS: TA registration, application default and attachments, safe review rendering, TA Q&A view');
