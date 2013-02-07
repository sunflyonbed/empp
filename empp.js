/*
  AUTHOR:sunyuanhua
	TIME:2012/11/15
	EMAIL:sunricharde@gmail.com
	Any problem found, plz contact me.XD~
	Use this file plz ensure that u have install {iconv-lite} and {redis} modules in nodejs.
*/
var companyId = ''
var Service_Id = ''
var pwd = ''
var HOST = '211.136.163.68';
var PORT = 9981;

var Sequence_Id=0;
var msgid = 0;//useless
var intval=null;
var timeout=null;
var cansend=false;
var iconv = require('iconv-lite');//used to convert to GBK
var redis =  require('redis');// to store phone number
var redisclient=redis.createClient();
var net = require('net');
var fs = require('fs');
var FSNAME ='EMPPlog.txt';//log file
var fd = fs.openSync(FSNAME,'a');
var fsfile='';//log content
var client = new net.Socket();
var mysql= require("mysql");
var mysqlconf={host:'localhost',user:'root',password:'19900210',database:'empp',insecureAuth:'true'};

var mysqlclient=mysql.createConnection(mysqlconf);
sql="set names utf8";
mysqlclient.query(sql);
mysqlclient.on('error',function(err){
		sql="set names utf8";
		mysqlclient.query(sql);
		console.log("mysql error:"+err);
		mysqlclient=mysql.createConnection(mysqlconf);
	});

client.setEncoding('Binary');
redisclient.set('sqid',Sequence_Id);
redisclient.on("error", function (err) {
        console.log("Error " + err);
        redisclient=redis.createClient();
    });
	Connect();
	Process();
	Http();
	intval=setInterval(Active,60000);//Based on test result,3 minutes will cause disconnection.
	process.on('uncaughtException', function (err) {
	  console.log('Caught exception: ' + err+" \nstack:"+err.stack);
	  cansend=false;
		Reconnect();

	});
	


function Reconnect(){
	console.log('###############RECONNECT###############');
	client.destroy();
	clearInterval(intval);
	Connect();
	goSubmit();// each time reconnect, submit left message in the redis
	intval=setInterval(Active,60000);
}
//initial and 
function Http(){
	var url=require('url');
	var http=require('http');
	var qstr=require('querystring');
	http.createServer(function(req,res){
		//get information
		var content=url.parse(req.url).query;
		if(!content){
			res.write('-6');
			res.end();
			return;
		}
		//check whether the input is legal
		if (content.search("phone")!=-1 && content.search("content")!=-1 && content.search("account")!=-1 && content.search("password")!=-1){
			var phones=qstr.parse(content)["phone"].split(",");
			var message=qstr.parse(content)["content"];
			//check userinfo
			password=md5(qstr.parse(content)["password"]);
			username=qstr.parse(content)["account"];
			sql="select * from userlist where username=? and password=?";
			mysqlclient.query(sql,[username,password],function(err,rows,fields){
				if (typeof(rows[0])=='undefined'){
					res.write('-1');				
				//}else	if (message.length>70){
					//res.write('ILLEGAL MESSAGE LENGTH:'+message.length+'\n');
				//	res.write('-2');
				}else{
					//check length fo phone length
					var legal=true;
					for (i=0;i<phones.length;i++){
							if (!isMobile(phones[i])){
								//res.write('ILLEGAL PHONE LENGTH|PHONE NUMBER:'+phones[i]+'\n');
								res.write('-3');
								legal=false;
							}
						}
					if (legal){
						//save into redis
						Redisave(phones,message,res,username);
						//submit
						goSubmit();
					}
				}
				res.end();
			});
			
		}else{
			//res.write("PARAMETER MISSING {phone|content|account|password} ");
			res.write('-5');
			res.end();
		}
	
	}).listen(80);
}

//if player really want to fake a number, then he will fake like 13811111111.
function isMobile(vStr){  
    var vReg = /^1(3|4|5|8)\d{9}$/;
    return vReg.test(vStr);
}
function dividemes(message){
		fragment=Math.ceil(message.length/60)
		divmes=new Array()
		for (var i=0;i<fragment;i++){
    	divmes[i]=message.substr(i*60,60);
		}
		return divmes;
}
//save the information into redis EMPPHASH {Seqence_id(FIELD),phonenumber}
function Redisave(phones,message,res,executor){
	 var divmes=dividemes(message);
	 var divlength=divmes.length;
	 var phonenum=phones.length;
	 var total=phonenum*divlength;
	 res.write(total.toString(10));
	 var substart=Sequence_Id;
	 Sequence_Id+=total;//this range of SI is occupied by submitSI |no other function can use
	 redisclient.incrby('sqid',total);
	 var sql="insert into empplog (sqid,phone,content,status,time,executor) values ";
	 var sqlword=new Array();
	 for (i=1;i<=phonenum;i++){
	 	for (j=1;j<=divlength;j++){
		 	date=new Date();
		 	sqlword.push(mysqlclient.format("(?,?,?,?,?,?)",[i*j+substart,phones[i-1],divmes[j-1],0,date,executor]));
		 	redisclient.del(i*j+substart);
		 	redisclient.hset(i*j+substart,phones[i-1],divmes[j-1]);
		 	redisclient.expire(i*j+substart,3600);
		 	redisclient.rpush('empplist',i*j+substart);	
		}
	 }
 		sql += sqlword.join(",");
		//console.log("sql="+sql);
		mysqlclient.query(sql);	 
}
//Connect
function Connect(){
	redisclient.exists('sqid',function(err,res){
		if (res==1){
			redisclient.get('sqid',function (err,res){
				Sequence_Id=parseInt(res,10);//convert into int since the key in redis is string
			});
		}else{
			Sequence_Id=0;
			redisclient.set('sqid',Sequence_Id);
		}
		});
	client.connect(PORT, HOST);
}

//analyse the data! most important part
function Process(wait){
	client.on('data',function(data){
		//console.log(test(data));    //used to check the return data in byte form
		//check length legality
		if (data.length<12){
			console.log('ACTIVE_TEST FAILED!UNKOWN RESP');
		}else{
			state=checkresp(data.substr(4,4));
			if (state=='80000001'){
				//EMPP_CONNECT_RESP
				checkconnect(data.substr(12,4));
			}else	if (state=='80000004'){
				//EMPP_SUBMIT_RESP
				checksubmit(data.substr(8,4));
			}else if (state=='80000008'){
				//EMPP_ACTIVE_TEST_RESP
				checkactive(data.substr(8,4));
			}else if (state=='00000005'){
				//EMPP_DELIVER
				checkdeliver(data);
			}else if (state=='00000002'){
				//EMPP_TERMINATE			
				console.log('GET EMPP_TERMINATE!');
			}else{
				console.log('GET OTHER RESP! RESP DATA IS:');
				console.log(test(data));//show other result not included above
			}
		}
	});
	//ERROR RECONNECT
	client.on('error',function(error){
		cansend=false
		console.log('SOCKET ERROR:'+error);	
		Reconnect();
	});

	//CONNECT THEN AUTHORIZATION CHECK
	client.on('connect',function(){
		console.log('CONNECTED TO: ' + HOST + ':' + PORT);
		client.write(makeConnect(),'Binary');
	});
}

//Active check
function Active(){
	//build active word
	
	var connectlen=12;
	var Total_Length=makeRepeat(chr(0),3)+chr(connectlen);
	var Command_Id=hextoByte('00000008');
	Sequence_Id++;
	console.log('START ACTIVE_TEST AT Sequence_Id:'+Sequence_Id);
	redisclient.incr('sqid');
	var Sequence=makeSequence(Sequence_Id);
	var checkinfo=Total_Length+Command_Id+Sequence;
	client.write(checkinfo,'Binary');
	timeout=setTimeout(function(){
		console.log('NO ACTIVE_TEST_RESP RECIEVED IN 5S!');
		Reconnect();
	},5000);

	//clear the hash if no transmission| with acitve so each 3 minutes clean the hash XD,avoid accumulation
}

//build connect word
function makeConnect(){
	//message body
	var connectlen=54;
	var accountlen=21;
	var time=maketime();
	var version=chr(16);
	var accountId=companyId+makeRepeat(chr(0),7); 
	var Ctime=hextoByte(parseInt(time,10).toString(16));
	var zerostring=makeRepeat(chr(0),2);
	var AuthenticatorSource=hextoByte(md5(accountId+zerostring+pwd+time));
	var EMPP_CONNECT=accountId+AuthenticatorSource+version+Ctime;
	//message header
	var Total_Length=makeRepeat(chr(0),3)+chr(connectlen);
	var Command_Id=hextoByte('00000001');
	Sequence_Id++;
	redisclient.incr('sqid');
	var Sequence=makeSequence(Sequence_Id);
	var EMPP_HEADER=Total_Length+Command_Id+Sequence;
	return EMPP_HEADER+EMPP_CONNECT;
}

//build submit word on num
function makeSubmit(num,content,seqid){
	//message body
	num=num.toString(10); //convert integer to string,otherwise the length would be 1
	var EMPP_SUBMIT='';
	console.log('START EMPP_SUBMIT AT Sequence_Id:'+seqid);
	EMPP_SUBMIT+=hextoByte(makeRepeat('0', 20-msgid.toString(16).length)+msgid.toString(16));//Msg_Id
	msgid++;
	EMPP_SUBMIT+=chr(1);//Pk_total
	EMPP_SUBMIT+=chr(1);//Pk_number
	EMPP_SUBMIT+=chr(1);//Registered_Delivery
	EMPP_SUBMIT+=chr(15);//Msg_Fmt
	EMPP_SUBMIT+=makeRepeat(chr(0),17);//ValId_Time
	EMPP_SUBMIT+=makeRepeat(chr(0),17);;//At_Time
	EMPP_SUBMIT+=makeRepeat(chr(0),3)+chr(1);//DestUsr_tl
	EMPP_SUBMIT+=num+makeRepeat(chr(0), 32-num.length);//Dest_terminal_Id
	EMPP_SUBMIT+=chr(iconv.encode(content,'GBK').length);//Msg_Length	
	EMPP_SUBMIT+=word(iconv.encode(content,'GBK'));//Msg_Content //in nodejs BUFFER type.
	EMPP_SUBMIT+=makeRepeat(chr(0),21);//Msg_src
	EMPP_SUBMIT+=companyId+makeRepeat(chr(0), 21-companyId.length);//Src_Id
	//EMPP_SUBMIT+=makeRepear('0',9)+chr(0);//Service_Id
	EMPP_SUBMIT+=Service_Id;
	EMPP_SUBMIT+=makeRepeat(chr(0), 66);	//Remain
	//EMPP_SUBMIT+=makeRepeat(chr(0), 20);//LinkID
	//EMPP_SUBMIT+=chr(1);//Msg_level
	//EMPP_SUBMIT+=chr(2);//Fee_UserType
	//EMPP_SUBMIT+=makeRepeat(chr(0), 32);//Fee_terminal_Id
	//EMPP_SUBMIT+=chr(1);//Fee_terminal_type
	//EMPP_SUBMIT+=chr(0);//TP_pId
	//EMPP_SUBMIT+=chr(0);//TP_udhi
	//EMPP_SUBMIT+='01';//FeeType
	//EMPP_SUBMIT+='0'+makeRepeat(chr(0), 5);//FeeCode
	//EMPP_SUBMIT+=chr(0);//Dest_terminal_type
	//message header
	var connectlen=EMPP_SUBMIT.length+12;
	var Total_Length=makeSequence(connectlen);
	var Command_Id=hextoByte('00000004');
	var Sequence=makeSequence(seqid);
	var EMPP_HEADER=Total_Length+Command_Id+Sequence;
	//console.log(test(EMPP_HEADER+EMPP_SUBMIT));
	return EMPP_HEADER+EMPP_SUBMIT;
}
//make GBK in buffer become into byte stream.
function word(str){
	var newstr='';
	var strlen=str.length;
	for (var i = 0; i < str.length ; i++) {
  	newstr += chr(str[i]);
	}
	return newstr;
}

//make word times of time
function makeRepeat(word,times){
  var str='';
  for (var i = 0; i < times; i++) {
      str += word;
  }
  return str;
}

//convert hex to byte ,num of hex be even. 2N HEX TO N BYTE
function hextoByte(str){
	if(str.length%2!=0){
		str='0'+str;
	}
	newstr='';
	length=str.length;
	for (i=0;i<length;i=i+2){
		hex=parseInt(str.substr(i,2),16);
		newstr=newstr+chr(hex);
	}
	return newstr;
}

//test function to show the ord queue, in hex form
function test(str){
	newstr='';
	length=str.length;
	for (i=0;i<length;i=i+1){
		newstr=newstr+ord(str.substr(i,1)).toString(16)+'|';
	}
	return newstr;

}

//md5 function 
function md5(str){	
	crypto=require('crypto');
	var hasher=crypto.createHash("md5");
	hasher.update(str);
	var hashmsg=hasher.digest('hex');
	return hashmsg;
}

function chr(str){
	return String.fromCharCode(str);
}

function ord(str){
	return str.charCodeAt(0)
}

//make sequenceid,4 byte
function makeSequence(num){
	var rsequence=parseInt(num,10).toString(16);
	var hexlen=rsequence.length;
	var limit=8;	//4byte so 4*2=8
	for (i=0;i<limit-hexlen;i++){
		rsequence='0'+rsequence;
	}
	return hextoByte(rsequence);
}
//zero makeup 1=> 01
function even(str){
	if (str.length < 2){
	    str='0'+str;
	}
	return str;
}
//build time in EMPP_CONNECT
function maketime(){
	var date=new Date()
	var str='';
	str+=even(String(date.getMonth()+1));
	str+=even(String(date.getDate()));
	str+=even(String(date.getHours()));
	str+=even(String(date.getMinutes()));
	str+=even(String(date.getSeconds()));
	return str;
}
//build time in EMPP_SUBMIT {nano second to be 0,last 4 bytes fixed to be 032+}
function getsubtime(){
	var date=new Date()
	var str=String(date.getFullYear()).substr(2,2);
	str+=even(String(date.getMonth()+1));
	str+=even(String(date.getDate()));
	str+=even(String(date.getHours()));
	str+=even(String(date.getMinutes()));
	str+=even(String(date.getSeconds()));
	return str+'0032+';
}
//check 4 byte EMPP_CONNECT_RESP
function checkconnect(str){
	var date=new Date();
	var newstr='';
	for(i=0;i<4;i++){
		newstr=newstr+ord(str[i]).toString(16);
	}
	if (newstr=='0000'){
		console.log("EMPP_CONNECT_RESP SUCCESS! AT "+date);
		cansend=true;
	}else{
		console.log("EMPP_CONNECT_RESP FAILED! AT "+date);
		
	}
}

//return the RESP state 
function checkresp(str){
	var newstr='';
	for(i=0;i<4;i++){
		newstr=newstr+even(ord(str[i]).toString(16));
	}
	return newstr;
}

function checkactive(str){
	clearTimeout(timeout);
	var date=new Date();
	var findsq=findseqence(str);
	console.log('ACTIVE_TEST_RESP SUCCESS!|SEQUENCE_ID:'+findsq+'|TIME:'+date);
}
//no check deliver state function since Im lazy.If get SUBMIT_RESP but no DILIVER_RESP then the wrong number || UNICOM PHONE NUMBER
function checksubmit(str){
	var findsq=findseqence(str);
	updatestatus(findsq,2);
	fsfile='EMPP_SUBMIT_RESP RECIEVED!';
	Empplog(findsq);
}

function checkdeliver(str){
	var findsq=findseqence(str.substr(8,4));
	var state=str.substr(101,7);
	if (state=='DELIVRD'){
		updatestatus(findsq,3);
		//del the key in redis since the deliver_resp is received
		fsfile='EMPP_DELIEVER SUCCESS!';
		Empplog(findsq);
		redisclient.del(findsq);		
	}else{
		updatestatus(findsq,4);
		fsfile='EMPP_DELIEVER FAILED!REASON:'+state;
		Empplog(findsq);
		redisclient.del(findsq);
	}
}
//empplog.txt
function Empplog(sqid){
		redisclient.hkeys(sqid,function(err,res){			
		fsfile+='|SEQUENCE_ID:'+sqid+'|PHONE NUM:'+res;
		console.log(fsfile);	
		fsfile+='\n';
		fs.writeSync(fd,fsfile,undefined, undefined, null);
		/*
		fs.open(FSNAME, 'a', undefined, function(err, fd) {
			if(err) throw err;
			var date = new Date();
			fsfile = "["+date.toLocaleString()+"]"+fsfile;
			fs.write(fd, fsfile, undefined, undefined, null, function(err, written) {
				if(err) throw err;		
				fs.close(fd);
			});
		});		
		*/
		//fs.appendFileSync(FSNAME,fsfile);
		});	
}

function findseqence(str){
	var newstr='';
	for(i=0;i<4;i++){
		newstr=newstr+ord(str[i]).toString(16);
	}
	newstr=parseInt(newstr,16).toString(10);
	return newstr;
}

function goSubmit(){
	var subint=setInterval(function(){	
		redisclient.llen('empplist',function(err,res){
			if (res<1){
				clearInterval(subint);
			}else if (cansend){
				redisclient.lpop('empplist',function(err,res){
					var sqid=res;	
					redisclient.hkeys(sqid,function(err,res){
						var phonenum=res;
						redisclient.hvals(sqid,function(err,res){
							var	content=res;
							client.write(makeSubmit(phonenum,content,sqid),'Binary');
							fsfile='EMPP_SUBMIT SUCCESS!';
							Empplog(sqid);
							updatestatus(sqid,1);				
						});			
					});	
				});
			}			
		});		
	},200);
}

function updatestatus(sqid,stat){
	sql="UPDATE empplog SET status=? where sqid=?";
	mysqlclient.query(sql,[stat,sqid],function(err,results){
		if (err){
			console.log(err);
		}
		});
}
