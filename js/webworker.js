/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) 2019-2020 MlesTalk WebWorker developers
 */

importScripts('cbor.js', 'blake2s.js', 'blowfish.js');

let gWebSocket;
let gMyAddr;
let gMyPort;
let gMyUid;
let gMyChannel;
let gChannelKey;
const SCATTERSIZE = 15;
const ISFULL = 0x8000
const ISIMAGE = 0x4000;
const ISPRESENCE = 0x8000;
const ISMULTI = 0x4000;
const ISFIRST = 0x2000;
const ISLAST = 0x1000;
const BEGIN = new Date(Date.UTC(2018, 0, 1, 0, 0, 0));
const HMAC_LEN = 12;
const NONCE_LEN = 16;

/* Msg type flags */
const MSGISFULL =       0x1;
const MSGISPRESENCE =  (0x1 << 1);
const MSGISIMAGE =     (0x1 << 2);
const MSGISMULTIPART = (0x1 << 3);
const MSGISFIRST =     (0x1 << 4);
const MSGISLAST =      (0x1 << 5);

function scatterTime(rvalU32, valU32, timeU15) {
	//check first which bits to use
	let tbit = new Uint32Array(1);
	let bit = new Uint32Array(1);
	let numofones = 0;
	let isOnes = true;
	for (let i = 31; i >= 0; i--) {
		bit[0] = (rvalU32 & (1 << i)) >> i;
		if (bit[0] > 0) {
			numofones++;
		}
	}
	let timeslot = SCATTERSIZE;
	if (numofones <= timeslot)
		isOnes = false;
	for (let i = 31; i >= 0; i--) {
		bit[0] = (rvalU32 & (1 << i)) >> i;
		if ((isOnes && bit[0] > 0) || (false == isOnes && 0 == bit[0])) {
			//apply setting to next item
			tbit[0] = (timeU15 & (1 << timeslot)) >> timeslot;
			if (tbit[0] > 0) {
				valU32 |= (1 << i);
			}
			else {
				valU32 &= ~(1 << i);
			}
			timeslot--;
			if (timeslot < 0)
				break;
		}
	}
	return valU32;
}

function unscatterTime(rvalU32, svalU32) {
	//check first which bits to use
	let timeU15 = new Uint32Array(1);
	let sbit = new Uint32Array(1);
	let bit = new Uint32Array(1);
	let numofones = 0;
	let isOnes = true;
	for (let i = 31; i >= 0; i--) {
		bit[0] = (rvalU32 & (1 << i)) >> i;
		if (bit[0] > 0) {
			numofones++;
		}
	}
	let timeslot = SCATTERSIZE;
	if (numofones <= timeslot)
		isOnes = false;
	for (let i = 31; i >= 0; i--) {
		bit[0] = (rvalU32 & (1 << i)) >> i;
		if ((isOnes && bit[0] > 0) || (false == isOnes && 0 == bit[0])) {
			sbit[0] = (svalU32 & (1 << i)) >> i;
			if (sbit[0] > 0)
				timeU15[0] |= (1 << timeslot);
			timeslot--;
			if (timeslot < 0)
				break;
		}
	}
	return timeU15[0];
}

function createTimestamp(valueofdate, weekstamp) {
	let begin = BEGIN;
	let this_week = new Date(begin.valueOf() + weekstamp * 1000 * 60 * 60 * 24 * 7);
	let timestamp = parseInt((valueofdate - this_week) / 1000 / 60);
	return timestamp;
}

function createWeekstamp(valueofdate) {
	let begin = BEGIN;
	let now = new Date(valueofdate);
	let weekstamp = parseInt((now - begin) / 1000 / 60 / 60 / 24 / 7);
	return weekstamp;
}

function readTimestamp(timestamp, weekstamp) {
	let begin = BEGIN;
	let weeks = new Date(begin.valueOf() + weekstamp * 1000 * 60 * 60 * 24 * 7);
	let extension = timestamp * 1000 * 60;
	let time = new Date(weeks.valueOf() + extension);
	return time;
}

function isEqualHmacs(hmac, rhmac) {
	let mac1 = new BLAKE2s(HMAC_LEN);
	let mac2 = new BLAKE2s(HMAC_LEN);

	mac1.update(hmac);
	mac2.update(rhmac);

	let hmac1 = mac1.digest();
	let hmac2 = mac2.digest();

	for (let i = 0; i < hmac1.byteLength; i++) {
		if (hmac1[i] != hmac2[i]) {
			return false;
		}
	}
	return true;
}

function nonce2u8arr(nonce) {
	let nonceu8 = new Uint8Array(NONCE_LEN);
	nonceu8[0] = nonce[0] >> 24;
	nonceu8[1] = nonce[0] >> 16 & 0xff;
	nonceu8[2] = nonce[0] >> 8 & 0xff;
	nonceu8[3] = nonce[0] & 0xff;
	nonceu8[4] = nonce[1] >> 24;
	nonceu8[5] = nonce[1] >> 16 & 0xff;
	nonceu8[6] = nonce[1] >> 8 & 0xff;
	nonceu8[7] = nonce[1] & 0xff;
	nonceu8[8] = nonce[2] >> 24;
	nonceu8[9] = nonce[2] >> 16 & 0xff;
	nonceu8[10] = nonce[2] >> 8 & 0xff;
	nonceu8[11] = nonce[2] & 0xff;
	nonceu8[12] = nonce[3] >> 24;
	nonceu8[13] = nonce[3] >> 16 & 0xff;
	nonceu8[14] = nonce[3] >> 8 & 0xff;
	nonceu8[15] = nonce[3] & 0xff;
	return nonceu8;
}

function u8arr2nonce(noncem) {
	let nonce = new Uint32Array(4);
	nonce[0] = noncem[0] << 24 | noncem[1] << 16 | noncem[2] << 8 | noncem[3];
	nonce[1] = noncem[4] << 24 | noncem[5] << 16 | noncem[6] << 8 | noncem[7];
	return nonce;
}

function load32(a, i) {
	return (a[i + 0] & 0xff) | ((a[i + 1] & 0xff) << 8) |
		((a[i + 2] & 0xff) << 16) | ((a[i + 3] & 0xff) << 24);
}

function store32(a, i, val) {
	a[i + 0] = val & 0xff;
	a[i + 1] = (val & 0xff00) >> 8;
	a[i + 2] = (val & 0xff0000) >> 16;
	a[i + 3] = (val & 0xff000000) >> 24;
	return a;
}

function StringToUint8(str) {
	let arr = new Uint8Array(str.length);
	let len = str.length;
	for (let i = 0; i < len; i++) {
		arr[i] = str.charCodeAt(i);
	}
	return arr;
}

function Uint8ToString(arr) {
	let str = new String('');
	for (let i = 0; i < arr.length; i++) {
		str += String.fromCharCode(arr[i]);
	};
	return str;
}

function processOnMessageData(msg) {
	//sanity
	if (msg.message.byteLength <= NONCE_LEN || msg.message.byteLength > 0xffffff) {
		return;
	}

	let noncem = msg.message.slice(0, NONCE_LEN);
	let arr = msg.message.slice(NONCE_LEN, msg.message.byteLength - HMAC_LEN);
	let hmac = msg.message.slice(msg.message.byteLength - HMAC_LEN, msg.message.byteLength)
	let message = Uint8ToString(arr);

	//verify first hmac
	let hmacarr = new Uint8Array(noncem.byteLength + arr.byteLength);
	hmacarr.set(noncem, 0);
	hmacarr.set(arr, noncem.byteLength);
	let blakehmac = new BLAKE2s(HMAC_LEN, gChannelKey);
	blakehmac.update(hmacarr);
	let rhmac = blakehmac.digest();
	if (false == isEqualHmacs(hmac, rhmac)) {
		return;
	}

	let nonce = u8arr2nonce(noncem);
	let iv = nonce.slice(0, 2);

	let uid = gChanCrypt.trimZeros(gChanCrypt.decrypt(atob(msg.uid)));
	let channel = gChanCrypt.trimZeros(gChanCrypt.decrypt(atob(msg.channel)));
	let decrypted = gMsgCrypt.decrypt(message, iv);

	if (decrypted.length < 16) {
		return;
	}

	let timestring = decrypted.slice(0, 8);
	let rarray = gMsgCrypt.split64by32(timestring);
	let timeU15 = unscatterTime(rarray[0], rarray[1]);
	let weekstring = decrypted.slice(8, 16);
	let warray = gMsgCrypt.split64by32(weekstring);
	let weekU15 = unscatterTime(warray[0], warray[1]);
	let msgDate = readTimestamp(timeU15 & ~(ISFULL | ISIMAGE), weekU15 & ~(ISPRESENCE | ISMULTI | ISFIRST | ISLAST));
	message = decrypted.slice(16, decrypted.byteLength);

	let msgtype = 0;
	if (timeU15 & ISFULL)
		msgtype |= MSGISFULL;
	if (timeU15 & ISIMAGE)
		msgtype |= MSGISIMAGE;
	if (weekU15 & ISPRESENCE)
		msgtype |= MSGISPRESENCE;
	if (weekU15 & ISMULTI)
		msgtype |= MSGISMULTIPART;
	if (weekU15 & ISFIRST)
		msgtype |= MSGISFIRST;
	if (weekU15 & ISLAST)
		msgtype |= MSGISLAST;

	postMessage(["data", uid, channel, msgDate.valueOf(), message, msgtype]);
}

function msgDecode(data) {
	try {
		return CBOR.decode(data);
	} catch (err) {
		return null;
	}
}

function msgEncode(obj) {
	try {
		return CBOR.encode(obj);
	} catch (err) {
		return null;
	}
}

function processOnClose() {
	gWebSocket.close();
	let uid = gChanCrypt.trimZeros(gChanCrypt.decrypt(atob(gMyUid)));
	let channel = gChanCrypt.trimZeros(gChanCrypt.decrypt(atob(gMyChannel)));
	postMessage(["close", uid, channel, gMyUid, gMyChannel]);
}

function processOnOpen() {
	let uid = gChanCrypt.trimZeros(gChanCrypt.decrypt(atob(gMyUid)));
	let channel = gChanCrypt.trimZeros(gChanCrypt.decrypt(atob(gMyChannel)));
	postMessage(["init", uid, channel, gMyUid, gMyChannel]);
}

function openSocket(gMyPort, gMyAddr) {
	if (gWebSocket !== undefined && gWebSocket.readyState == WebSocket.OPEN) {
		return;
	}

	gWebSocket = new WebSocket("wss://" + gMyAddr + ":" + gMyPort, "mles-websocket");
	gWebSocket.binaryType = "arraybuffer";
	gWebSocket.onopen = function (event) {
		let ret = processOnOpen();
		if(ret < 0)
			console.log("Process on open failed: " + ret);

	};

	gWebSocket.onmessage = function (event) {
		if (event.data) {
			let msg = msgDecode(event.data);
			if(!msg)
				return;

			let ret = processOnMessageData(msg);
			if(ret < 0)
				console.log("Process on message data failed: " + ret);
		}
	};

	gWebSocket.onclose = function (event) {
		let ret = processOnClose();
		if(ret < 0)
			console.log("Process on close failed: " + ret)
	};
}

function createChannelKey(passwd) {
	let round = new BLAKE2s(32, passwd);
	let blakecb = new BLAKE2s(7); //56-bits max key len
	blakecb.update(round.digest());
	return blakecb.digest();
}

function createChannelAontKey(passwd) {
	let round = new BLAKE2s(32, passwd);
	round.update(passwd);
	let blakeaontecb = new BLAKE2s(8); //aont key len
	blakeaontecb.update(round.digest());
	return blakeaontecb.digest();
}

function createMessageKey(passwd) {
	let blakecbc = new BLAKE2s(7); //56-bits max key len
	blakecbc.update(passwd);
	return blakecbc.digest();
}

function createMessageAontKey(passwd) {
	let round = new BLAKE2s(32, passwd);
	round.update(passwd);
	round.update(passwd);
	let blakeaontcbc = new BLAKE2s(8); //aont key len
	blakeaontcbc.update(round.digest());
	return blakeaontcbc.digest();
}

function createChannelCrypt(channelKey, channelAontKey) {
	return new Blowfish(channelKey, channelAontKey);
}

function createMessageCrypt(messageKey, messageAontKey) {
	return new Blowfish(messageKey, messageAontKey, "cbc");
}

onmessage = function (e) {
	let cmd = e.data[0];
	let data = e.data[1];

	switch (cmd) {
		case "init":
			{
				gMyAddr = e.data[2];
				gMyPort = e.data[3];
				let uid = e.data[4];
				let channel = e.data[5];
				let passwd = StringToUint8(e.data[6]);
				let isEncryptedChannel = e.data[7];

				let gChannelKey = createChannelKey(passwd);
				let channelAontKey = createChannelAontKey(passwd);
				let messageKey = createMessageKey(passwd);
				let messageAontKey = createMessageAontKey(passwd)

				gChanCrypt = createChannelCrypt(gChannelKey, channelAontKey);	
				gMsgCrypt = createMessageCrypt(messageKey, messageAontKey);
				gMyUid = btoa(gChanCrypt.encrypt(uid));

				//wipe unused
				passwd = "";
				channelAontKey = "";
				messageKey = "";
				messageAontKey = "";

				let bfchannel;
				if (!isEncryptedChannel) {
					bfchannel = gChanCrypt.encrypt(channel);
					gMyChannel = btoa(bfchannel);
				}
				else {
					gMyChannel = channel;
				}
				openSocket(gMyPort, gMyAddr);
			}
			break;
		case "reconnect":
			{
				let uid = e.data[2];
				let channel = e.data[3];
				let isEncryptedChannel = e.data[4];

				uid = btoa(gChanCrypt.encrypt(uid));
				if (!isEncryptedChannel) {
					bfchannel = gChanCrypt.encrypt(channel);
					channel = btoa(bfchannel);
				}
				// verify that we have already opened the channel earlier
				if (gMyUid === uid && gMyChannel === channel) {
					openSocket(gMyPort, gMyAddr);
				}
			}
			break;
		case "send":
			{
				let uid = e.data[2];
				let channel = e.data[3];
				let isEncryptedChannel = e.data[4];
				let randarr = e.data[5];

				//sanity
				if (randarr.length != 8) {
					break;
				}

				let msgtype = e.data[6];
				let valueofdate = e.data[7];

				let iv = randarr.slice(0, 2);
				let nonce = randarr.slice(0, 4);
				let rarray = randarr.slice(4);

				if (isEncryptedChannel) {
					channel = gChanCrypt.trimZeros(gChanCrypt.decrypt(atob(channel)));
				}

				let weekstamp = createWeekstamp(valueofdate);
				let timestamp = createTimestamp(valueofdate, weekstamp);
				if (msgtype & MSGISFULL) {
					timestamp |= ISFULL;
				}
				if (msgtype & MSGISIMAGE) {
					timestamp |= ISIMAGE;
				}
				if (msgtype & MSGISPRESENCE) {
					weekstamp |= ISPRESENCE;
				}
				if (msgtype & MSGISMULTIPART) {
					weekstamp |= ISMULTI;
					if (msgtype & MSGISFIRST) {
						weekstamp |= ISFIRST;
					}
					if (msgtype & MSGISLAST) {
						weekstamp |= ISLAST;
					}
				}
				let sval = scatterTime(rarray[0], rarray[1], timestamp);
				rarray[1] = sval;
				sval = scatterTime(rarray[2], rarray[3], weekstamp);
				rarray[3] = sval;

				let newmessage = gMsgCrypt.num2block32(rarray[0]) + gMsgCrypt.num2block32(rarray[1]) +
					gMsgCrypt.num2block32(rarray[2]) + gMsgCrypt.num2block32(rarray[3]) + data;
				let encrypted = gMsgCrypt.encrypt(newmessage, iv);
				let noncearr = nonce2u8arr(nonce);
				let arr = StringToUint8(encrypted);

				// calculate hmac
				let hmacarr = new Uint8Array(noncearr.byteLength + arr.byteLength);
				hmacarr.set(noncearr, 0);
				hmacarr.set(arr, noncearr.byteLength);

				let blakehmac = new BLAKE2s(HMAC_LEN, gChannelKey);
				blakehmac.update(hmacarr);
				let hmac = blakehmac.digest();

				let newarr = new Uint8Array(noncearr.byteLength + arr.byteLength + hmac.byteLength);
				newarr.set(noncearr, 0);
				newarr.set(arr, noncearr.byteLength);
				newarr.set(hmac, noncearr.byteLength + arr.byteLength);
				let obj = {
					uid: btoa(gChanCrypt.encrypt(uid)),
					channel: btoa(gChanCrypt.encrypt(channel)),
					message: newarr
				};
				let encodedMsg = msgEncode(obj);
				if(!encodedMsg)
					break;
				try {
					gWebSocket.send(encodedMsg);
				} catch (err) {
					break;
				}
				postMessage(["send", uid, channel, msgtype & MSGISMULTIPART ? true : false]);
			}
			break;
		case "close":
			{
				//let uid = e.data[2];
				//let channel = e.data[3];
				//let isEncryptedChannel = e.data[4];
				gWebSocket.close();
			}
			break;
	}
}
