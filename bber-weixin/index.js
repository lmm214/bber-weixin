/**
 * 多用户 腾讯 CloudBase 微信公众号云函数
 * date: 2021.01.12 22:00
 * author: lmm214
 * homepage: https://immmmm.com/
**/
'use strict'
//引入模块
const tcb = require('@cloudbase/node-sdk')
const sha1 = require('js-sha1')
const xmlreader = require('xmlreader')
const request = require('request')
const path = require('path');
const fs = require('fs');

const token = 'weixin' // 微信公众号的服务器验证用的令牌 token

//填入自己的微信公众号appid和appsecret
var wxappid = '微信公众号appid',
    wxappsecret = '微信公众号appsecret',
    wxtoken = '',
    cdnQubu = false, //默认使用 TCB 自带5G云存储，true切换去不图床
    imgtype,
    houzhui = 'jpg',
    picUrl,
    test_media_id = ''

//云开发初始化
const app = tcb.init({ env: tcb.SYMBOL_CURRENT_ENV })
//数据库初始化
const db = app.database()
const collection = db.collection('users')

var response
exports.main = async (event, context) => {
    var signature = event.queryStringParameters.signature
    var timestamp = event.queryStringParameters.timestamp
    var nonce = event.queryStringParameters.nonce
    var tmpArr = [token,timestamp,nonce]
    var tmpStr = sha1(tmpArr.sort().join(''))
    if(tmpStr == signature){
        //请求来源鉴权
        //成功后注释下行代码
        return event.queryStringParameters.echostr //成功后注释本行代码
        //成功后注释上行代码

        var requestData = event.body
        //如果数据被base64加密过，则解码
        if(event.isBase64Encoded) requestData = (new Buffer(requestData, 'base64')).toString()
        xmlreader.read(requestData, function(err,res){requestData = res})

        var fromUserName = requestData.xml.FromUserName.text(),
            toUserName = requestData.xml.ToUserName.text(),
            createTime = Date.now(),
            msgType = requestData.xml.MsgType.text(),
            content = '',
            mediaId = ''
        if (msgType == 'text') {
            content = requestData.xml.Content.text()
        } else if (msgType == 'image') {
            content = requestData.xml.PicUrl.text()
            mediaId = requestData.xml.MediaId.text()
        }
        //获取用户信息
        const user = await collection.where({open_id:fromUserName}).get()
        if(user.data.length <= 0){
            // 用户不存在
            if(/^\/bber[\: ]((?!,).)*,((?!,).)*$/.test(content)){
                var cloudInfo = (content.slice(6,content.length)).split(','),
                    Key = cloudInfo[0],
                    HttpUrl = cloudInfo[1]
                var bindRes = await collection.add({open_id: fromUserName,cloud_key: Key,cloud_httpurl: HttpUrl})
                if(bindRes.hasOwnProperty('id')){
                    content = '绑定成功，直接发「文字」或「图片」试试吧！\n---------------\n回复 /h 获取更多秘笈'
                }else{
                    content = '绑定失败'
                }
            }else{
                content = '「腾讯Cloudbase」一键部署 https://immmmm.com/bb-by-wechat-pro/\n---------------\n回复以下命令绑定用户 /bber bber,https://HTTP访问地址/bber'
            }
        }else if(user.data[0].open_id == fromUserName){
            if ((msgType != 'text') && (msgType != 'image')) {
                content = '消息类型不允许'
            } else{
                switch(content){
                    case '/h':
                        content = '「哔哔秘笈」\n==================\n/l - 显示最近哔哔\n/s 关键词 - 搜索内容\n---------------\n/a 文字 - 追加文字到第1条\n/a数字 文字 - 追加文字到第几条，如 /a2 文字\n---------------\n/c - 合并前2条\n/c数字 - 合并前几条，如 /c3\n---------------\n/d - 删除第1条\n/d数字 - 删除第几条，如 /d2\n---------------\n/e 文字- 编辑替换第1条\n/e数字 文字 - 编辑替换第几条，如 /e2 文字\n---------------\n/f数字 - 批量删除前几条，如 /f2\n---------------\n/nobber - 解除绑定'
                        break
                    case '/nobber':
                        var unbindRes = await collection.where({open_id: fromUserName}).remove()
                        if(unbindRes.hasOwnProperty('code')){
                            content = '解绑失败'
                        }else{
                            content = '解绑成功'
                        }
                        break
                    default :
                        var cloudHttpUrl = user.data[0].cloud_httpurl,
                            cloudKey = user.data[0].cloud_key
                        
                        if (content.slice(0,1) == '/' && content.slice(0,2) !== '/:') {
                            let letTer = content.slice(1,2)
                            if (letTer == 'a' || letTer == 'c' || letTer == 'd' || letTer == 'e' || letTer == 'f' || letTer == 'l' || letTer == 's'  ) {
                                let res = await cloudRequest(cloudHttpUrl,cloudKey,createTime,content)
                                if(res.statusCode == 200){
                                    content = JSON.parse(res.body).content
                                }else{
                                    content = '哔哔短路中：'+res.statusCode
                                }
                            }else{
                                content = '无此命令，回复 /h 查看更多'
                            }
                        }else{
                            //处理图片消息
                            if (msgType == 'image') {
                                test_media_id = mediaId
                                await getPicUrl(wxappid, wxappsecret, test_media_id)
                                if(cdnQubu == true){
                                    content = await uploadQubu(test_media_id, houzhui)
                                }else{
                                    content = await upPicTbc(test_media_id, houzhui)
                                }
                            }
                            let res = await cloudRequest(cloudHttpUrl,cloudKey,createTime,content)
                            //console.log(res)
                            if(res.statusCode == 200){
                                if (msgType == 'text') {
                                    content = '哔哔成功！'
                                } else if (msgType == 'image') {
                                    content = '发图成功！（使用 /a 可追加文字）\n-----------------\n'+content
                                }
                            }else{
                                content = '哔哔失败！'+res.statusCode
                            }
                        }     
                }
            }
        }else{
            content = '用户验证失败'
        }

        //构造响应消息字符串
        response = '<xml>\
                        <ToUserName>'+fromUserName+'</ToUserName>\
                        <FromUserName>'+toUserName+'</FromUserName>\
                        <CreateTime>'+createTime+'</CreateTime>\
                        <MsgType><![CDATA[text]]></MsgType>\
                        <Content>'+content+'</Content>\
                    </xml>'
        
        return response

    }else{
        //请求来源鉴权失败
        return {error: 'request_denined'}
    }
}

//使用promise封装request解决异步请求致无法获取结果的问题
function cloudRequest(cloudHttpUrl,cloudKey,createTime,content){
    return new Promise(function(resoved,rejevted){
        var param1 = {'key': cloudKey,'time': createTime,'text': content,'from':'微信公众号'}
        request({
            url: cloudHttpUrl,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            qs: param1
        },function(error, res, body) {
            if(error){
                rejevted(error)
            }else{
                resoved(res)
            }
        })
    })
}

//获取access_token函数
function getAccess_token(aid, asecret) {
    return new Promise(function (resolved, rejected) {
    try{
        request({
            url: 'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' + aid + '&secret=' + asecret,
            method: 'GET'
        }, function (error, res, body) {
            if (error) {
                rejected(error)  
            } else {
                res = JSON.parse(body)
                resolved(res.access_token)
            }
        })
    } catch (err) {
            console.log(err)
    }
    })
}

//获取微信临时素材后缀
function getvxImghouzhui(wxtoken, test_media_id) {
    return new Promise(function (resoved, rejected) {
    try{
        request({
            url: 'https://api.weixin.qq.com/cgi-bin/media/get?access_token=' + wxtoken + '&media_id=' + test_media_id,
            method: 'GET'
        }, function (error, res, body) {
            if (error) {
                rejected(error)
            } else {
                imgtype = res.caseless.dict['content-type']
                var houzhui = ''
                if (imgtype == 'image/jpeg') {
                    houzhui = 'jpg'
                } else if (imgtype == 'image/png') {
                    houzhui = 'png'
                } else if (imgtype == 'image/webp') {
                    houzhui = 'webp'
                } else if (imgtype == 'image/gif') {
                    houzhui = 'gif'
                }
                resoved(houzhui)
            }
        })
    } catch (err) {
            console.log(err)
    }
    })
}

//下载微信临时素材图片
function downloadPic(picUrl, test_media_id, houzhui) {
    return new Promise((r,e)=>{
    try {
        //改为下载至tmp临时空间
        const ws = fs.createWriteStream('/tmp/'+test_media_id+'.'+houzhui, { autoClose: true });
        request(picUrl).pipe(ws);
        ws.on('finish', function () {
            console.log('ok')
            r('下载临时素材成功！')
        });
    } catch (err) {
        console.log(err)
        e('下载临时素材失败！')
    }
});
}

//获取微信临时素材图片url
async function getPicUrl(wxappid, wxappsecret, test_media_id) {
    wxtoken = await getAccess_token(wxappid, wxappsecret)
    houzhui = await getvxImghouzhui(wxtoken, test_media_id)
    picUrl = 'https://api.weixin.qq.com/cgi-bin/media/get?access_token=' + wxtoken + '&media_id=' + test_media_id
    //下载图片到临时文件夹tmp
    await downloadPic(picUrl,test_media_id,houzhui)
}

function upPicTbc(test_media_id, houzhui) {
    return new Promise(function (resolved) {
        app.uploadFile({
            cloudPath: Date.now()+'.'+houzhui,
            fileContent: fs.createReadStream('/tmp/'+test_media_id+'.'+houzhui)
        })
        .then((res) => {
            console.log("res.fileID"+res.fileID)
            app.getTempFileURL({
                fileList: [res.fileID]
            }).then((res) => {
                console.log("res.fileList"+res.fileList)
                resolved(res.fileList[0].tempFileURL)
            });
        });
    })
}

function uploadQubu(test_media_id, houzhui) {
    return new Promise(function (resolved, rejected) {
        var formData = {
            'image': fs.createReadStream('/tmp/'+test_media_id+'.'+houzhui)
        }
        request({
            url: 'https://7bu.top/api/upload',
            method: 'POST',
            formData:formData
        }, function (error, res, body) {
            if (error) {
                rejected(error)  
            } else {
                res = JSON.parse(body)
                console.log('上传至去不图床成功！', res.data.url )
                deleteFolderRecursive('/tmp')
                resolved(res.data.url)
            }
        })
    })
}

//删除临时文件
function deleteFolderRecursive (url) {
    var files = [];
    //判断给定的路径是否存在
    if( fs.existsSync(url) ) {
        //返回文件和子目录的数组
        files = fs.readdirSync(url);
        files.forEach(function(file,index){
           // var curPath = url + "/" + file;
            var curPath = path.join(url,file);
            //fs.statSync同步读取文件夹文件，如果是文件夹，在重复触发函数
            if(fs.statSync(curPath).isDirectory()) { // recurse
                deleteFolderRecursive(curPath);
            // 是文件delete file  
            } else {
                fs.unlinkSync(curPath);
            }
        });
        //清除文件夹
        console.log(url+'删除成功');
    }else{
        console.log("给定的路径不存在，请给出正确的路径");
    }
};
