/////////////////////////////////////////////////////////////////////
// Copyright (c) Autodesk, Inc. All rights reserved
//
// Permission to use, copy, modify, and distribute this software in
// object code form for any purpose and without fee is hereby granted,
// provided that the above copyright notice appears in all copies and
// that both that copyright notice and the limited warranty and
// restricted rights notice below appear in all supporting
// documentation.
//
// AUTODESK PROVIDES THIS PROGRAM "AS IS" AND WITH ALL FAULTS.
// AUTODESK SPECIFICALLY DISCLAIMS ANY IMPLIED WARRANTY OF
// MERCHANTABILITY OR FITNESS FOR A PARTICULAR USE.  AUTODESK, INC.
// DOES NOT WARRANT THAT THE OPERATION OF THE PROGRAM WILL BE
// UNINTERRUPTED OR ERROR FREE.
/////////////////////////////////////////////////////////////////////

//-------------------------------------------------------------------
// These packages are included in package.json.
// Run `npm install` to install them.
// 'path' is part of Node.js and thus not inside package.json.
//-------------------------------------------------------------------
var express = require('express');           // For web server
var Axios = require('axios');               // A Promised base http client
var bodyParser = require('body-parser');    // Receive JSON format
// Set up Express web server
var app = express();
app.use(bodyParser.json());
app.use(express.static(__dirname + '/www'));
  
// This is for web server to start listening to port 3000
app.set('port', 3000);
var server = app.listen(app.get('port'), function () {
    console.log('Server listening on port ' + server.address().port);
});

server.timeout = 15*60*1000;

//-------------------------------------------------------------------
// Configuration for your Forge account
// Initialize the 2-legged OAuth2 client, and
// set specific scopes
//-------------------------------------------------------------------
var FORGE_CLIENT_ID = process.env.FORGE_CLIENT_ID;
var FORGE_CLIENT_SECRET = process.env.FORGE_CLIENT_SECRET;
var access_token = '';
var scopes = 'data:read data:write data:create bucket:create bucket:read';
const querystring = require('querystring');

const maxFileSize = 200 * 1024 * 1024; // 200M
const chunkSize = 50 * 1024 * 1024;// 50M
Axios.defaults.maxContentLength = maxFileSize;
Axios.defaults.maxBodyLength = maxFileSize;


// // Route /api/forge/oauth
app.get('/api/forge/oauth', function (req, res) {
    Axios({
        method: 'POST',
        url: 'https://developer.api.autodesk.com/authentication/v1/authenticate',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
        },
        data: querystring.stringify({
            client_id: FORGE_CLIENT_ID,
            client_secret: FORGE_CLIENT_SECRET,
            grant_type: 'client_credentials',
            scope: scopes
        })
    })
        .then(function (response) {
            // Success
            access_token = response.data.access_token;
            console.log(response);
            res.redirect('/api/forge/datamanagement/bucket/create');
        })
        .catch(function (error) {
            // Failed
            console.log(error);
            res.send('Failed to authenticate');
        });
});

// Route /api/forge/oauth/public
app.get('/api/forge/oauth/public', function (req, res) {
    // Limit public token to Viewer read only
    Axios({
        method: 'POST',
        url: 'https://developer.api.autodesk.com/authentication/v1/authenticate',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
        },
        data: querystring.stringify({
            client_id: FORGE_CLIENT_ID,
            client_secret: FORGE_CLIENT_SECRET,
            grant_type: 'client_credentials',
            scope: 'viewables:read'
        })
    })
        .then(function (response) {
            // Success
            console.log(response);
            res.json({ access_token: response.data.access_token, expires_in: response.data.expires_in });
        })
        .catch(function (error) {
            // Failed
            console.log(error);
            res.status(500).json(error);
        });
});

// Buckey key and Policy Key for OSS
const bucketKey = FORGE_CLIENT_ID.toLowerCase() + '_tutorial_bucket'; // Prefix with your ID so the bucket key is unique across all buckets on all other accounts
const policyKey = 'transient'; // Expires in 24hr

// Route /api/forge/datamanagement/bucket/create
app.get('/api/forge/datamanagement/bucket/create', function (req, res) {
    // Create an application shared bucket using access token from previous route
    // We will use this bucket for storing all files in this tutorial
    Axios({
        method: 'POST',
        url: 'https://developer.api.autodesk.com/oss/v2/buckets',
        headers: {
            'content-type': 'application/json',
            Authorization: 'Bearer ' + access_token
        },
        data: JSON.stringify({
            'bucketKey': bucketKey,
            'policyKey': policyKey
        })
    })
        .then(function (response) {
            // Success
            console.log(response);
            res.redirect('/api/forge/datamanagement/bucket/detail');
        })
        .catch(function (error) {
            if (error.response && error.response.status == 409) {
                console.log('Bucket already exists, skip creation.');
                res.redirect('/api/forge/datamanagement/bucket/detail');
            } else {
                // Failed
                console.log(error);
                res.send('Failed to create a new bucket');
            }
        });
});

// Route /api/forge/datamanagement/bucket/detail
app.get('/api/forge/datamanagement/bucket/detail', function (req, res) {
    Axios({
        method: 'GET',
        url: 'https://developer.api.autodesk.com/oss/v2/buckets/' + encodeURIComponent(bucketKey) + '/details',
        headers: {
            Authorization: 'Bearer ' + access_token
        }
    })
        .then(function (response) {
            // Success
            console.log(response);
            res.redirect('/upload.html');
        })
        .catch(function (error) {
            // Failed
            console.log(error);
            res.send('Failed to verify the new bucket');
        });
});

// For converting the source into a Base64-Encoded string
var Buffer = require('buffer').Buffer;
String.prototype.toBase64 = function () {
    // Buffer is part of Node.js to enable interaction with octet streams in TCP streams, 
    // file system operations, and other contexts.
    return new Buffer(this).toString('base64');
};

function chunkUpload(access_token, originalname, length, sessionId, range, readStream) {
    return new Promise(function (resolve, reject) {
        Axios({
            method: 'PUT',
            url: 'https://developer.api.autodesk.com/oss/v2/buckets/' + encodeURIComponent(bucketKey) + '/objects/' + encodeURIComponent(originalname) + '/resumable',
            headers: {
                Authorization: 'Bearer ' + access_token,
                'Content-Disposition': originalname,
                'Content-Length': length,
                'Session-Id': sessionId,
                'Content-Range': range
            },
            data: readStream
        })
            .then(function (response) {
                // Success
                console.log('Succeeded to upload one chunk...');
                resolve(response);
            })
            .catch(function (error) {
                // Failed
                console.log('Failed to upload one chunk...');
                resolve(error);
            });
    })
}

function delay(t, v) {
    return new Promise(function (resolve) {
        setTimeout(resolve.bind(null, v), t);
    });
}


var multer = require('multer');         // To handle file upload
var upload = multer({ dest: 'tmp/' }); // Save file into local /tmp folder

// Route /api/forge/datamanagement/bucket/upload
app.post('/api/forge/datamanagement/bucket/upload/:isSVF2', upload.single('fileToUpload'), async function (req, res) {
    var fs = require('fs'); // Node.js File system for reading files

    const isSVF2 = req.params.isSVF2;

    const fileSize = fs.statSync(req.file.path).size;

    if (fileSize > maxFileSize) {
        //resumable upload
        const nbChunks = Math.ceil(fileSize / chunkSize);
        const sessionId = parseInt(Math.random() * 1000, 20);
        console.log(`total chunks: ${nbChunks}`);

        var chunkIdx = 0;
        //normally, to have better performance, async process to build the uploading map
        //and also consider 429 （too many requests in one minute)
        //to make a simpler code, use while loop
        //and also keep original skeleton to respond client after uploading is done
        //(normally, the best design is client polls status, or use socket to notify client)

        var chunckUploadRes = null;
        while (chunkIdx < nbChunks) {

            const start = chunkIdx * chunkSize
            const end = Math.min(fileSize, (chunkIdx + 1) * chunkSize) - 1
            const range = "bytes " + start + "-" + end + "/" + fileSize;
            const length = end - start + 1;
            const readStream = fs.createReadStream(req.file.path, {
                start, end
            })
            console.log(`uploading chunk ${chunkIdx} : ${start} - ${end}`);

            chunckUploadRes = await chunkUpload(access_token, req.file.originalname, length, sessionId, range, readStream);
            //avoid error 429
            await delay(500);
            chunkIdx++;
        }

        //now check if all chunks are uploaded
        if (chunkIdx == nbChunks) {
            // Success 
            //all chunks are uploaded. only the last response will tell the urn
            var urn = chunckUploadRes.data.objectId.toBase64();
            res.redirect('/api/forge/modelderivative/' + urn + '/' + isSVF2);
        } else {
            // Failed
            console.log(error);
            res.send('Failed to create a new object in the bucket');
        }
    } else {
        //single upload
        fs.readFile(req.file.path, async function (err, filecontent) {

            Axios({
                method: 'PUT',
                url: 'https://developer.api.autodesk.com/oss/v2/buckets/' + encodeURIComponent(bucketKey) + '/objects/' + encodeURIComponent(req.file.originalname),
                headers: {
                    Authorization: 'Bearer ' + access_token,
                    'Content-Disposition': req.file.originalname,
                    'Content-Length': fileSize
                },
                data: filecontent
            })
                .then(function (response) {
                    // Success
                    console.log(response);
                    var urn = response.data.objectId.toBase64();
                    res.redirect('/api/forge/modelderivative/' + urn + '/0');
                })
                .catch(function (error) {
                    // Failed
                    console.log(error);
                    res.send('Failed to create a new object in the bucket');
                });
        })
    } 
});

// Route /api/forge/modelderivative
app.get('/api/forge/modelderivative/:urn/:isSVF2', function (req, res) {
    var urn = req.params.urn;
    var isSVF2 = req.params.isSVF2;

    var format_type = isSVF2 ? 'svf2' : 'svf';
    var format_views = ['2d', '3d'];
    Axios({
        method: 'POST',
        url: 'https://developer.api.autodesk.com/modelderivative/v2/designdata/job',
        headers: {
            'content-type': 'application/json',
            Authorization: 'Bearer ' + access_token
        },
        data: JSON.stringify({
            'input': {
                'urn': urn
            },
            'output': {
                'formats': [
                    {
                        'type': format_type,
                        'views': format_views
                    }
                ]
            }
        })
    })
        .then(function (response) {
            // Success
            console.log(response);
            res.redirect('/viewer.html?urn=' + urn + '&isSVF2=' + isSVF2);
        })
        .catch(function (error) {
            // Failed
            console.log(error);
            res.send('Error at Model Derivative job.');
        });
});
