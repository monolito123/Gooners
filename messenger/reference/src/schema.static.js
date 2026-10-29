/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-mixed-operators, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars, default-case, jsdoc/require-param*/
import $protobuf from "protobufjs/minimal.js";

const $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;
const $Object = $util.global.Object, $undefined = $util.global.undefined, $Error = $util.global.Error, $RangeError = $util.global.RangeError, $TypeError = $util.global.TypeError, $String = $util.global.String, $Array = $util.global.Array, $Number = $util.global.Number, $parseInt = $util.global.parseInt, $BigInt = $util.global.BigInt, $Boolean = $util.global.Boolean;

const $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

export const sma = $root.sma = (() => {

    const sma = {};

    sma.v1 = (function() {

        const v1 = {};

        v1.SignedBlob = (function() {

            const SignedBlob = function (p) {
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            SignedBlob.prototype.body = $util.newBuffer([]);
            SignedBlob.prototype.signer = $util.newBuffer([]);
            SignedBlob.prototype.signature = $util.newBuffer([]);

            SignedBlob.create = function(properties) {
                return new SignedBlob(properties);
            };

            SignedBlob.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.body != null && $Object.hasOwnProperty.call(m, "body") && m.body.length)
                    w.uint32(10).bytes(m.body);
                if (m.signer != null && $Object.hasOwnProperty.call(m, "signer") && m.signer.length)
                    w.uint32(18).bytes(m.signer);
                if (m.signature != null && $Object.hasOwnProperty.call(m, "signature") && m.signature.length)
                    w.uint32(26).bytes(m.signature);
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            SignedBlob.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.SignedBlob();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.body = v;
                            else
                                delete m.body;
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.signer = v;
                            else
                                delete m.signer;
                            continue;
                        }
                    case 3: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.signature = v;
                            else
                                delete m.signature;
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            SignedBlob.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.body != null && $Object.hasOwnProperty.call(m, "body")) {
                    if (!(m.body && typeof m.body.length === "number" || $util.isString(m.body)))
                        return "body: buffer expected";
                }
                if (m.signer != null && $Object.hasOwnProperty.call(m, "signer")) {
                    if (!(m.signer && typeof m.signer.length === "number" || $util.isString(m.signer)))
                        return "signer: buffer expected";
                }
                if (m.signature != null && $Object.hasOwnProperty.call(m, "signature")) {
                    if (!(m.signature && typeof m.signature.length === "number" || $util.isString(m.signature)))
                        return "signature: buffer expected";
                }
                return null;
            };

            SignedBlob.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.SignedBlob)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.SignedBlob: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.SignedBlob();
                if (d.body != null) {
                    if (d.body.length) {
                        if (typeof d.body === "string")
                            $util.base64.decode(d.body, m.body = $util.newBuffer($util.base64.length(d.body)), 0);
                        else if (d.body.length >= 0)
                            m.body = d.body;
                    }
                }
                if (d.signer != null) {
                    if (d.signer.length) {
                        if (typeof d.signer === "string")
                            $util.base64.decode(d.signer, m.signer = $util.newBuffer($util.base64.length(d.signer)), 0);
                        else if (d.signer.length >= 0)
                            m.signer = d.signer;
                    }
                }
                if (d.signature != null) {
                    if (d.signature.length) {
                        if (typeof d.signature === "string")
                            $util.base64.decode(d.signature, m.signature = $util.newBuffer($util.base64.length(d.signature)), 0);
                        else if (d.signature.length >= 0)
                            m.signature = d.signature;
                    }
                }
                return m;
            };

            SignedBlob.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.defaults) {
                    if (o.bytes === $String)
                        d.body = "";
                    else {
                        d.body = [];
                        if (o.bytes !== $Array)
                            d.body = $util.newBuffer(d.body);
                    }
                    if (o.bytes === $String)
                        d.signer = "";
                    else {
                        d.signer = [];
                        if (o.bytes !== $Array)
                            d.signer = $util.newBuffer(d.signer);
                    }
                    if (o.bytes === $String)
                        d.signature = "";
                    else {
                        d.signature = [];
                        if (o.bytes !== $Array)
                            d.signature = $util.newBuffer(d.signature);
                    }
                }
                if (m.body != null && $Object.hasOwnProperty.call(m, "body")) {
                    d.body = o.bytes === $String ? $util.base64.encode(m.body, 0, m.body.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.body) : m.body;
                }
                if (m.signer != null && $Object.hasOwnProperty.call(m, "signer")) {
                    d.signer = o.bytes === $String ? $util.base64.encode(m.signer, 0, m.signer.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.signer) : m.signer;
                }
                if (m.signature != null && $Object.hasOwnProperty.call(m, "signature")) {
                    d.signature = o.bytes === $String ? $util.base64.encode(m.signature, 0, m.signature.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.signature) : m.signature;
                }
                return d;
            };

            SignedBlob.prototype.toJSON = function() {
                return SignedBlob.toObject(this, $protobuf.util.toJSONOptions);
            };

            SignedBlob.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.SignedBlob";
            };

            return SignedBlob;
        })();

        v1.PrekeyBundle = (function() {

            const PrekeyBundle = function (p) {
                this.devices = [];
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            PrekeyBundle.prototype.version = 0;
            PrekeyBundle.prototype.identityKey = $util.newBuffer([]);
            PrekeyBundle.prototype.identityKemKey = $util.newBuffer([]);
            PrekeyBundle.prototype.signedPrekey = null;
            PrekeyBundle.prototype.devices = $util.emptyArray;
            PrekeyBundle.prototype.publishedAtMs = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

            PrekeyBundle.create = function(properties) {
                return new PrekeyBundle(properties);
            };

            PrekeyBundle.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.version != null && $Object.hasOwnProperty.call(m, "version") && m.version !== 0)
                    w.uint32(8).uint32(m.version);
                if (m.identityKey != null && $Object.hasOwnProperty.call(m, "identityKey") && m.identityKey.length)
                    w.uint32(18).bytes(m.identityKey);
                if (m.identityKemKey != null && $Object.hasOwnProperty.call(m, "identityKemKey") && m.identityKemKey.length)
                    w.uint32(26).bytes(m.identityKemKey);
                if (m.signedPrekey != null && $Object.hasOwnProperty.call(m, "signedPrekey"))
                    $root.sma.v1.SignedPrekey.encode(m.signedPrekey, w.uint32(34).fork(), q + 1).ldelim();
                if (m.devices != null && m.devices.length) {
                    for (var i = 0; i < m.devices.length; ++i)
                        $root.sma.v1.SignedBlob.encode(m.devices[i], w.uint32(42).fork(), q + 1).ldelim();
                }
                if (m.publishedAtMs != null && $Object.hasOwnProperty.call(m, "publishedAtMs") && (typeof m.publishedAtMs === "object" ? m.publishedAtMs.low || m.publishedAtMs.high : m.publishedAtMs !== 0))
                    w.uint32(48).uint64(m.publishedAtMs);
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            PrekeyBundle.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.PrekeyBundle();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 0)
                                break;
                            if (v = r.uint32())
                                m.version = v;
                            else
                                delete m.version;
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.identityKey = v;
                            else
                                delete m.identityKey;
                            continue;
                        }
                    case 3: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.identityKemKey = v;
                            else
                                delete m.identityKemKey;
                            continue;
                        }
                    case 4: {
                            if (u !== 2)
                                break;
                            m.signedPrekey = $root.sma.v1.SignedPrekey.decode(r, r.size(), $undefined, q + 1, m.signedPrekey);
                            continue;
                        }
                    case 5: {
                            if (u !== 2)
                                break;
                            if (!(m.devices && m.devices.length))
                                m.devices = [];
                            m.devices.push($root.sma.v1.SignedBlob.decode(r, r.size(), $undefined, q + 1));
                            continue;
                        }
                    case 6: {
                            if (u !== 0)
                                break;
                            if (typeof (v = r.uint64()) === "object" ? v.low || v.high : v !== 0)
                                m.publishedAtMs = v;
                            else
                                delete m.publishedAtMs;
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            PrekeyBundle.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.version != null && $Object.hasOwnProperty.call(m, "version")) {
                    if (!$util.isInteger(m.version))
                        return "version: integer expected";
                }
                if (m.identityKey != null && $Object.hasOwnProperty.call(m, "identityKey")) {
                    if (!(m.identityKey && typeof m.identityKey.length === "number" || $util.isString(m.identityKey)))
                        return "identityKey: buffer expected";
                }
                if (m.identityKemKey != null && $Object.hasOwnProperty.call(m, "identityKemKey")) {
                    if (!(m.identityKemKey && typeof m.identityKemKey.length === "number" || $util.isString(m.identityKemKey)))
                        return "identityKemKey: buffer expected";
                }
                if (m.signedPrekey != null && $Object.hasOwnProperty.call(m, "signedPrekey")) {
                    {
                        var e = $root.sma.v1.SignedPrekey.verify(m.signedPrekey, q + 1);
                        if (e)
                            return "signedPrekey." + e;
                    }
                }
                if (m.devices != null && $Object.hasOwnProperty.call(m, "devices")) {
                    if (!$Array.isArray(m.devices))
                        return "devices: array expected";
                    for (var i = 0; i < m.devices.length; ++i) {
                        {
                            var e = $root.sma.v1.SignedBlob.verify(m.devices[i], q + 1);
                            if (e)
                                return "devices." + e;
                        }
                    }
                }
                if (m.publishedAtMs != null && $Object.hasOwnProperty.call(m, "publishedAtMs")) {
                    if (!$util.isInteger(m.publishedAtMs) && !(m.publishedAtMs && $util.isInteger(m.publishedAtMs.low) && $util.isInteger(m.publishedAtMs.high)))
                        return "publishedAtMs: integer|Long expected";
                }
                return null;
            };

            PrekeyBundle.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.PrekeyBundle)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.PrekeyBundle: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.PrekeyBundle();
                if (d.version != null) {
                    if ($Number(d.version) !== 0) {
                        m.version = d.version >>> 0;
                    }
                }
                if (d.identityKey != null) {
                    if (d.identityKey.length) {
                        if (typeof d.identityKey === "string")
                            $util.base64.decode(d.identityKey, m.identityKey = $util.newBuffer($util.base64.length(d.identityKey)), 0);
                        else if (d.identityKey.length >= 0)
                            m.identityKey = d.identityKey;
                    }
                }
                if (d.identityKemKey != null) {
                    if (d.identityKemKey.length) {
                        if (typeof d.identityKemKey === "string")
                            $util.base64.decode(d.identityKemKey, m.identityKemKey = $util.newBuffer($util.base64.length(d.identityKemKey)), 0);
                        else if (d.identityKemKey.length >= 0)
                            m.identityKemKey = d.identityKemKey;
                    }
                }
                if (d.signedPrekey != null) {
                    if (!$util.isObject(d.signedPrekey))
                        throw $TypeError(".sma.v1.PrekeyBundle.signedPrekey: object expected");
                    m.signedPrekey = $root.sma.v1.SignedPrekey.fromObject(d.signedPrekey, q + 1);
                }
                if (d.devices) {
                    if (!$Array.isArray(d.devices))
                        throw $TypeError(".sma.v1.PrekeyBundle.devices: array expected");
                    m.devices = $Array(d.devices.length);
                    for (var i = 0; i < d.devices.length; ++i) {
                        if (!$util.isObject(d.devices[i]))
                            throw $TypeError(".sma.v1.PrekeyBundle.devices: object expected");
                        m.devices[i] = $root.sma.v1.SignedBlob.fromObject(d.devices[i], q + 1);
                    }
                }
                if (d.publishedAtMs != null) {
                    if (typeof d.publishedAtMs === "object" ? d.publishedAtMs.low || d.publishedAtMs.high : $Number(d.publishedAtMs) !== 0) {
                        if ($util.Long)
                            m.publishedAtMs = $util.Long.fromValue(d.publishedAtMs, true);
                        else if (typeof d.publishedAtMs === "string")
                            m.publishedAtMs = $parseInt(d.publishedAtMs, 10);
                        else if (typeof d.publishedAtMs === "number")
                            m.publishedAtMs = d.publishedAtMs;
                        else if (typeof d.publishedAtMs === "object")
                            m.publishedAtMs = new $util.LongBits(d.publishedAtMs.low >>> 0, d.publishedAtMs.high >>> 0).toNumber(true);
                    }
                }
                return m;
            };

            PrekeyBundle.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.arrays || o.defaults) {
                    d.devices = [];
                }
                if (o.defaults) {
                    d.version = 0;
                    if (o.bytes === $String)
                        d.identityKey = "";
                    else {
                        d.identityKey = [];
                        if (o.bytes !== $Array)
                            d.identityKey = $util.newBuffer(d.identityKey);
                    }
                    if (o.bytes === $String)
                        d.identityKemKey = "";
                    else {
                        d.identityKemKey = [];
                        if (o.bytes !== $Array)
                            d.identityKemKey = $util.newBuffer(d.identityKemKey);
                    }
                    d.signedPrekey = null;
                    if ($util.Long) {
                        var n = new $util.Long(0, 0, true);
                        d.publishedAtMs = o.longs === $String ? n.toString() : o.longs === $Number ? n.toNumber() : typeof $BigInt !== "undefined" && o.longs === $BigInt ? n.toBigInt() : n;
                    } else
                        d.publishedAtMs = o.longs === $String ? "0" : typeof $BigInt !== "undefined" && o.longs === $BigInt ? $BigInt("0") : 0;
                }
                if (m.version != null && $Object.hasOwnProperty.call(m, "version")) {
                    d.version = m.version;
                }
                if (m.identityKey != null && $Object.hasOwnProperty.call(m, "identityKey")) {
                    d.identityKey = o.bytes === $String ? $util.base64.encode(m.identityKey, 0, m.identityKey.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.identityKey) : m.identityKey;
                }
                if (m.identityKemKey != null && $Object.hasOwnProperty.call(m, "identityKemKey")) {
                    d.identityKemKey = o.bytes === $String ? $util.base64.encode(m.identityKemKey, 0, m.identityKemKey.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.identityKemKey) : m.identityKemKey;
                }
                if (m.signedPrekey != null && $Object.hasOwnProperty.call(m, "signedPrekey")) {
                    d.signedPrekey = $root.sma.v1.SignedPrekey.toObject(m.signedPrekey, o, q + 1);
                }
                if (m.devices && m.devices.length) {
                    d.devices = $Array(m.devices.length);
                    for (var j = 0; j < m.devices.length; ++j) {
                        d.devices[j] = $root.sma.v1.SignedBlob.toObject(m.devices[j], o, q + 1);
                    }
                }
                if (m.publishedAtMs != null && $Object.hasOwnProperty.call(m, "publishedAtMs")) {
                    if (typeof $BigInt !== "undefined" && o.longs === $BigInt)
                        d.publishedAtMs = typeof m.publishedAtMs === "number" ? $BigInt(m.publishedAtMs) : $util.Long.fromBits(m.publishedAtMs.low >>> 0, m.publishedAtMs.high >>> 0, true).toBigInt();
                    else if (typeof m.publishedAtMs === "number")
                        d.publishedAtMs = o.longs === $String ? $String(m.publishedAtMs) : m.publishedAtMs;
                    else
                        d.publishedAtMs = o.longs === $String ? $util.Long.prototype.toString.call(m.publishedAtMs) : o.longs === $Number ? new $util.LongBits(m.publishedAtMs.low >>> 0, m.publishedAtMs.high >>> 0).toNumber(true) : m.publishedAtMs;
                }
                return d;
            };

            PrekeyBundle.prototype.toJSON = function() {
                return PrekeyBundle.toObject(this, $protobuf.util.toJSONOptions);
            };

            PrekeyBundle.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.PrekeyBundle";
            };

            return PrekeyBundle;
        })();

        v1.SignedPrekey = (function() {

            const SignedPrekey = function (p) {
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            SignedPrekey.prototype.id = 0;
            SignedPrekey.prototype.publicKey = $util.newBuffer([]);
            SignedPrekey.prototype.createdAtMs = $util.Long ? $util.Long.fromBits(0,0,true) : 0;
            SignedPrekey.prototype.expiresAtMs = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

            SignedPrekey.create = function(properties) {
                return new SignedPrekey(properties);
            };

            SignedPrekey.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.id != null && $Object.hasOwnProperty.call(m, "id") && m.id !== 0)
                    w.uint32(8).uint32(m.id);
                if (m.publicKey != null && $Object.hasOwnProperty.call(m, "publicKey") && m.publicKey.length)
                    w.uint32(18).bytes(m.publicKey);
                if (m.createdAtMs != null && $Object.hasOwnProperty.call(m, "createdAtMs") && (typeof m.createdAtMs === "object" ? m.createdAtMs.low || m.createdAtMs.high : m.createdAtMs !== 0))
                    w.uint32(24).uint64(m.createdAtMs);
                if (m.expiresAtMs != null && $Object.hasOwnProperty.call(m, "expiresAtMs") && (typeof m.expiresAtMs === "object" ? m.expiresAtMs.low || m.expiresAtMs.high : m.expiresAtMs !== 0))
                    w.uint32(32).uint64(m.expiresAtMs);
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            SignedPrekey.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.SignedPrekey();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 0)
                                break;
                            if (v = r.uint32())
                                m.id = v;
                            else
                                delete m.id;
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.publicKey = v;
                            else
                                delete m.publicKey;
                            continue;
                        }
                    case 3: {
                            if (u !== 0)
                                break;
                            if (typeof (v = r.uint64()) === "object" ? v.low || v.high : v !== 0)
                                m.createdAtMs = v;
                            else
                                delete m.createdAtMs;
                            continue;
                        }
                    case 4: {
                            if (u !== 0)
                                break;
                            if (typeof (v = r.uint64()) === "object" ? v.low || v.high : v !== 0)
                                m.expiresAtMs = v;
                            else
                                delete m.expiresAtMs;
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            SignedPrekey.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.id != null && $Object.hasOwnProperty.call(m, "id")) {
                    if (!$util.isInteger(m.id))
                        return "id: integer expected";
                }
                if (m.publicKey != null && $Object.hasOwnProperty.call(m, "publicKey")) {
                    if (!(m.publicKey && typeof m.publicKey.length === "number" || $util.isString(m.publicKey)))
                        return "publicKey: buffer expected";
                }
                if (m.createdAtMs != null && $Object.hasOwnProperty.call(m, "createdAtMs")) {
                    if (!$util.isInteger(m.createdAtMs) && !(m.createdAtMs && $util.isInteger(m.createdAtMs.low) && $util.isInteger(m.createdAtMs.high)))
                        return "createdAtMs: integer|Long expected";
                }
                if (m.expiresAtMs != null && $Object.hasOwnProperty.call(m, "expiresAtMs")) {
                    if (!$util.isInteger(m.expiresAtMs) && !(m.expiresAtMs && $util.isInteger(m.expiresAtMs.low) && $util.isInteger(m.expiresAtMs.high)))
                        return "expiresAtMs: integer|Long expected";
                }
                return null;
            };

            SignedPrekey.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.SignedPrekey)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.SignedPrekey: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.SignedPrekey();
                if (d.id != null) {
                    if ($Number(d.id) !== 0) {
                        m.id = d.id >>> 0;
                    }
                }
                if (d.publicKey != null) {
                    if (d.publicKey.length) {
                        if (typeof d.publicKey === "string")
                            $util.base64.decode(d.publicKey, m.publicKey = $util.newBuffer($util.base64.length(d.publicKey)), 0);
                        else if (d.publicKey.length >= 0)
                            m.publicKey = d.publicKey;
                    }
                }
                if (d.createdAtMs != null) {
                    if (typeof d.createdAtMs === "object" ? d.createdAtMs.low || d.createdAtMs.high : $Number(d.createdAtMs) !== 0) {
                        if ($util.Long)
                            m.createdAtMs = $util.Long.fromValue(d.createdAtMs, true);
                        else if (typeof d.createdAtMs === "string")
                            m.createdAtMs = $parseInt(d.createdAtMs, 10);
                        else if (typeof d.createdAtMs === "number")
                            m.createdAtMs = d.createdAtMs;
                        else if (typeof d.createdAtMs === "object")
                            m.createdAtMs = new $util.LongBits(d.createdAtMs.low >>> 0, d.createdAtMs.high >>> 0).toNumber(true);
                    }
                }
                if (d.expiresAtMs != null) {
                    if (typeof d.expiresAtMs === "object" ? d.expiresAtMs.low || d.expiresAtMs.high : $Number(d.expiresAtMs) !== 0) {
                        if ($util.Long)
                            m.expiresAtMs = $util.Long.fromValue(d.expiresAtMs, true);
                        else if (typeof d.expiresAtMs === "string")
                            m.expiresAtMs = $parseInt(d.expiresAtMs, 10);
                        else if (typeof d.expiresAtMs === "number")
                            m.expiresAtMs = d.expiresAtMs;
                        else if (typeof d.expiresAtMs === "object")
                            m.expiresAtMs = new $util.LongBits(d.expiresAtMs.low >>> 0, d.expiresAtMs.high >>> 0).toNumber(true);
                    }
                }
                return m;
            };

            SignedPrekey.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.defaults) {
                    d.id = 0;
                    if (o.bytes === $String)
                        d.publicKey = "";
                    else {
                        d.publicKey = [];
                        if (o.bytes !== $Array)
                            d.publicKey = $util.newBuffer(d.publicKey);
                    }
                    if ($util.Long) {
                        var n = new $util.Long(0, 0, true);
                        d.createdAtMs = o.longs === $String ? n.toString() : o.longs === $Number ? n.toNumber() : typeof $BigInt !== "undefined" && o.longs === $BigInt ? n.toBigInt() : n;
                    } else
                        d.createdAtMs = o.longs === $String ? "0" : typeof $BigInt !== "undefined" && o.longs === $BigInt ? $BigInt("0") : 0;
                    if ($util.Long) {
                        var n = new $util.Long(0, 0, true);
                        d.expiresAtMs = o.longs === $String ? n.toString() : o.longs === $Number ? n.toNumber() : typeof $BigInt !== "undefined" && o.longs === $BigInt ? n.toBigInt() : n;
                    } else
                        d.expiresAtMs = o.longs === $String ? "0" : typeof $BigInt !== "undefined" && o.longs === $BigInt ? $BigInt("0") : 0;
                }
                if (m.id != null && $Object.hasOwnProperty.call(m, "id")) {
                    d.id = m.id;
                }
                if (m.publicKey != null && $Object.hasOwnProperty.call(m, "publicKey")) {
                    d.publicKey = o.bytes === $String ? $util.base64.encode(m.publicKey, 0, m.publicKey.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.publicKey) : m.publicKey;
                }
                if (m.createdAtMs != null && $Object.hasOwnProperty.call(m, "createdAtMs")) {
                    if (typeof $BigInt !== "undefined" && o.longs === $BigInt)
                        d.createdAtMs = typeof m.createdAtMs === "number" ? $BigInt(m.createdAtMs) : $util.Long.fromBits(m.createdAtMs.low >>> 0, m.createdAtMs.high >>> 0, true).toBigInt();
                    else if (typeof m.createdAtMs === "number")
                        d.createdAtMs = o.longs === $String ? $String(m.createdAtMs) : m.createdAtMs;
                    else
                        d.createdAtMs = o.longs === $String ? $util.Long.prototype.toString.call(m.createdAtMs) : o.longs === $Number ? new $util.LongBits(m.createdAtMs.low >>> 0, m.createdAtMs.high >>> 0).toNumber(true) : m.createdAtMs;
                }
                if (m.expiresAtMs != null && $Object.hasOwnProperty.call(m, "expiresAtMs")) {
                    if (typeof $BigInt !== "undefined" && o.longs === $BigInt)
                        d.expiresAtMs = typeof m.expiresAtMs === "number" ? $BigInt(m.expiresAtMs) : $util.Long.fromBits(m.expiresAtMs.low >>> 0, m.expiresAtMs.high >>> 0, true).toBigInt();
                    else if (typeof m.expiresAtMs === "number")
                        d.expiresAtMs = o.longs === $String ? $String(m.expiresAtMs) : m.expiresAtMs;
                    else
                        d.expiresAtMs = o.longs === $String ? $util.Long.prototype.toString.call(m.expiresAtMs) : o.longs === $Number ? new $util.LongBits(m.expiresAtMs.low >>> 0, m.expiresAtMs.high >>> 0).toNumber(true) : m.expiresAtMs;
                }
                return d;
            };

            SignedPrekey.prototype.toJSON = function() {
                return SignedPrekey.toObject(this, $protobuf.util.toJSONOptions);
            };

            SignedPrekey.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.SignedPrekey";
            };

            return SignedPrekey;
        })();

        v1.OneTimePrekey = (function() {

            const OneTimePrekey = function (p) {
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            OneTimePrekey.prototype.id = 0;
            OneTimePrekey.prototype.publicKey = $util.newBuffer([]);
            OneTimePrekey.prototype.expiresAtMs = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

            OneTimePrekey.create = function(properties) {
                return new OneTimePrekey(properties);
            };

            OneTimePrekey.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.id != null && $Object.hasOwnProperty.call(m, "id") && m.id !== 0)
                    w.uint32(8).uint32(m.id);
                if (m.publicKey != null && $Object.hasOwnProperty.call(m, "publicKey") && m.publicKey.length)
                    w.uint32(18).bytes(m.publicKey);
                if (m.expiresAtMs != null && $Object.hasOwnProperty.call(m, "expiresAtMs") && (typeof m.expiresAtMs === "object" ? m.expiresAtMs.low || m.expiresAtMs.high : m.expiresAtMs !== 0))
                    w.uint32(24).uint64(m.expiresAtMs);
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            OneTimePrekey.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.OneTimePrekey();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 0)
                                break;
                            if (v = r.uint32())
                                m.id = v;
                            else
                                delete m.id;
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.publicKey = v;
                            else
                                delete m.publicKey;
                            continue;
                        }
                    case 3: {
                            if (u !== 0)
                                break;
                            if (typeof (v = r.uint64()) === "object" ? v.low || v.high : v !== 0)
                                m.expiresAtMs = v;
                            else
                                delete m.expiresAtMs;
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            OneTimePrekey.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.id != null && $Object.hasOwnProperty.call(m, "id")) {
                    if (!$util.isInteger(m.id))
                        return "id: integer expected";
                }
                if (m.publicKey != null && $Object.hasOwnProperty.call(m, "publicKey")) {
                    if (!(m.publicKey && typeof m.publicKey.length === "number" || $util.isString(m.publicKey)))
                        return "publicKey: buffer expected";
                }
                if (m.expiresAtMs != null && $Object.hasOwnProperty.call(m, "expiresAtMs")) {
                    if (!$util.isInteger(m.expiresAtMs) && !(m.expiresAtMs && $util.isInteger(m.expiresAtMs.low) && $util.isInteger(m.expiresAtMs.high)))
                        return "expiresAtMs: integer|Long expected";
                }
                return null;
            };

            OneTimePrekey.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.OneTimePrekey)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.OneTimePrekey: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.OneTimePrekey();
                if (d.id != null) {
                    if ($Number(d.id) !== 0) {
                        m.id = d.id >>> 0;
                    }
                }
                if (d.publicKey != null) {
                    if (d.publicKey.length) {
                        if (typeof d.publicKey === "string")
                            $util.base64.decode(d.publicKey, m.publicKey = $util.newBuffer($util.base64.length(d.publicKey)), 0);
                        else if (d.publicKey.length >= 0)
                            m.publicKey = d.publicKey;
                    }
                }
                if (d.expiresAtMs != null) {
                    if (typeof d.expiresAtMs === "object" ? d.expiresAtMs.low || d.expiresAtMs.high : $Number(d.expiresAtMs) !== 0) {
                        if ($util.Long)
                            m.expiresAtMs = $util.Long.fromValue(d.expiresAtMs, true);
                        else if (typeof d.expiresAtMs === "string")
                            m.expiresAtMs = $parseInt(d.expiresAtMs, 10);
                        else if (typeof d.expiresAtMs === "number")
                            m.expiresAtMs = d.expiresAtMs;
                        else if (typeof d.expiresAtMs === "object")
                            m.expiresAtMs = new $util.LongBits(d.expiresAtMs.low >>> 0, d.expiresAtMs.high >>> 0).toNumber(true);
                    }
                }
                return m;
            };

            OneTimePrekey.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.defaults) {
                    d.id = 0;
                    if (o.bytes === $String)
                        d.publicKey = "";
                    else {
                        d.publicKey = [];
                        if (o.bytes !== $Array)
                            d.publicKey = $util.newBuffer(d.publicKey);
                    }
                    if ($util.Long) {
                        var n = new $util.Long(0, 0, true);
                        d.expiresAtMs = o.longs === $String ? n.toString() : o.longs === $Number ? n.toNumber() : typeof $BigInt !== "undefined" && o.longs === $BigInt ? n.toBigInt() : n;
                    } else
                        d.expiresAtMs = o.longs === $String ? "0" : typeof $BigInt !== "undefined" && o.longs === $BigInt ? $BigInt("0") : 0;
                }
                if (m.id != null && $Object.hasOwnProperty.call(m, "id")) {
                    d.id = m.id;
                }
                if (m.publicKey != null && $Object.hasOwnProperty.call(m, "publicKey")) {
                    d.publicKey = o.bytes === $String ? $util.base64.encode(m.publicKey, 0, m.publicKey.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.publicKey) : m.publicKey;
                }
                if (m.expiresAtMs != null && $Object.hasOwnProperty.call(m, "expiresAtMs")) {
                    if (typeof $BigInt !== "undefined" && o.longs === $BigInt)
                        d.expiresAtMs = typeof m.expiresAtMs === "number" ? $BigInt(m.expiresAtMs) : $util.Long.fromBits(m.expiresAtMs.low >>> 0, m.expiresAtMs.high >>> 0, true).toBigInt();
                    else if (typeof m.expiresAtMs === "number")
                        d.expiresAtMs = o.longs === $String ? $String(m.expiresAtMs) : m.expiresAtMs;
                    else
                        d.expiresAtMs = o.longs === $String ? $util.Long.prototype.toString.call(m.expiresAtMs) : o.longs === $Number ? new $util.LongBits(m.expiresAtMs.low >>> 0, m.expiresAtMs.high >>> 0).toNumber(true) : m.expiresAtMs;
                }
                return d;
            };

            OneTimePrekey.prototype.toJSON = function() {
                return OneTimePrekey.toObject(this, $protobuf.util.toJSONOptions);
            };

            OneTimePrekey.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.OneTimePrekey";
            };

            return OneTimePrekey;
        })();

        v1.DeviceCertificate = (function() {

            const DeviceCertificate = function (p) {
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            DeviceCertificate.prototype.deviceId = $util.newBuffer([]);
            DeviceCertificate.prototype.deviceSigningKey = $util.newBuffer([]);
            DeviceCertificate.prototype.deviceKemKey = $util.newBuffer([]);
            DeviceCertificate.prototype.issuedAtMs = $util.Long ? $util.Long.fromBits(0,0,true) : 0;
            DeviceCertificate.prototype.expiresAtMs = $util.Long ? $util.Long.fromBits(0,0,true) : 0;
            DeviceCertificate.prototype.label = "";
            DeviceCertificate.prototype.capabilities = 0;

            DeviceCertificate.create = function(properties) {
                return new DeviceCertificate(properties);
            };

            DeviceCertificate.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.deviceId != null && $Object.hasOwnProperty.call(m, "deviceId") && m.deviceId.length)
                    w.uint32(10).bytes(m.deviceId);
                if (m.deviceSigningKey != null && $Object.hasOwnProperty.call(m, "deviceSigningKey") && m.deviceSigningKey.length)
                    w.uint32(18).bytes(m.deviceSigningKey);
                if (m.deviceKemKey != null && $Object.hasOwnProperty.call(m, "deviceKemKey") && m.deviceKemKey.length)
                    w.uint32(26).bytes(m.deviceKemKey);
                if (m.issuedAtMs != null && $Object.hasOwnProperty.call(m, "issuedAtMs") && (typeof m.issuedAtMs === "object" ? m.issuedAtMs.low || m.issuedAtMs.high : m.issuedAtMs !== 0))
                    w.uint32(32).uint64(m.issuedAtMs);
                if (m.expiresAtMs != null && $Object.hasOwnProperty.call(m, "expiresAtMs") && (typeof m.expiresAtMs === "object" ? m.expiresAtMs.low || m.expiresAtMs.high : m.expiresAtMs !== 0))
                    w.uint32(40).uint64(m.expiresAtMs);
                if (m.label != null && $Object.hasOwnProperty.call(m, "label") && m.label !== "")
                    w.uint32(50).string(m.label);
                if (m.capabilities != null && $Object.hasOwnProperty.call(m, "capabilities") && m.capabilities !== 0)
                    w.uint32(56).uint32(m.capabilities);
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            DeviceCertificate.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.DeviceCertificate();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.deviceId = v;
                            else
                                delete m.deviceId;
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.deviceSigningKey = v;
                            else
                                delete m.deviceSigningKey;
                            continue;
                        }
                    case 3: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.deviceKemKey = v;
                            else
                                delete m.deviceKemKey;
                            continue;
                        }
                    case 4: {
                            if (u !== 0)
                                break;
                            if (typeof (v = r.uint64()) === "object" ? v.low || v.high : v !== 0)
                                m.issuedAtMs = v;
                            else
                                delete m.issuedAtMs;
                            continue;
                        }
                    case 5: {
                            if (u !== 0)
                                break;
                            if (typeof (v = r.uint64()) === "object" ? v.low || v.high : v !== 0)
                                m.expiresAtMs = v;
                            else
                                delete m.expiresAtMs;
                            continue;
                        }
                    case 6: {
                            if (u !== 2)
                                break;
                            if ((v = r.stringVerify()).length)
                                m.label = v;
                            else
                                delete m.label;
                            continue;
                        }
                    case 7: {
                            if (u !== 0)
                                break;
                            if (v = r.uint32())
                                m.capabilities = v;
                            else
                                delete m.capabilities;
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            DeviceCertificate.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.deviceId != null && $Object.hasOwnProperty.call(m, "deviceId")) {
                    if (!(m.deviceId && typeof m.deviceId.length === "number" || $util.isString(m.deviceId)))
                        return "deviceId: buffer expected";
                }
                if (m.deviceSigningKey != null && $Object.hasOwnProperty.call(m, "deviceSigningKey")) {
                    if (!(m.deviceSigningKey && typeof m.deviceSigningKey.length === "number" || $util.isString(m.deviceSigningKey)))
                        return "deviceSigningKey: buffer expected";
                }
                if (m.deviceKemKey != null && $Object.hasOwnProperty.call(m, "deviceKemKey")) {
                    if (!(m.deviceKemKey && typeof m.deviceKemKey.length === "number" || $util.isString(m.deviceKemKey)))
                        return "deviceKemKey: buffer expected";
                }
                if (m.issuedAtMs != null && $Object.hasOwnProperty.call(m, "issuedAtMs")) {
                    if (!$util.isInteger(m.issuedAtMs) && !(m.issuedAtMs && $util.isInteger(m.issuedAtMs.low) && $util.isInteger(m.issuedAtMs.high)))
                        return "issuedAtMs: integer|Long expected";
                }
                if (m.expiresAtMs != null && $Object.hasOwnProperty.call(m, "expiresAtMs")) {
                    if (!$util.isInteger(m.expiresAtMs) && !(m.expiresAtMs && $util.isInteger(m.expiresAtMs.low) && $util.isInteger(m.expiresAtMs.high)))
                        return "expiresAtMs: integer|Long expected";
                }
                if (m.label != null && $Object.hasOwnProperty.call(m, "label")) {
                    if (!$util.isString(m.label))
                        return "label: string expected";
                }
                if (m.capabilities != null && $Object.hasOwnProperty.call(m, "capabilities")) {
                    if (!$util.isInteger(m.capabilities))
                        return "capabilities: integer expected";
                }
                return null;
            };

            DeviceCertificate.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.DeviceCertificate)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.DeviceCertificate: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.DeviceCertificate();
                if (d.deviceId != null) {
                    if (d.deviceId.length) {
                        if (typeof d.deviceId === "string")
                            $util.base64.decode(d.deviceId, m.deviceId = $util.newBuffer($util.base64.length(d.deviceId)), 0);
                        else if (d.deviceId.length >= 0)
                            m.deviceId = d.deviceId;
                    }
                }
                if (d.deviceSigningKey != null) {
                    if (d.deviceSigningKey.length) {
                        if (typeof d.deviceSigningKey === "string")
                            $util.base64.decode(d.deviceSigningKey, m.deviceSigningKey = $util.newBuffer($util.base64.length(d.deviceSigningKey)), 0);
                        else if (d.deviceSigningKey.length >= 0)
                            m.deviceSigningKey = d.deviceSigningKey;
                    }
                }
                if (d.deviceKemKey != null) {
                    if (d.deviceKemKey.length) {
                        if (typeof d.deviceKemKey === "string")
                            $util.base64.decode(d.deviceKemKey, m.deviceKemKey = $util.newBuffer($util.base64.length(d.deviceKemKey)), 0);
                        else if (d.deviceKemKey.length >= 0)
                            m.deviceKemKey = d.deviceKemKey;
                    }
                }
                if (d.issuedAtMs != null) {
                    if (typeof d.issuedAtMs === "object" ? d.issuedAtMs.low || d.issuedAtMs.high : $Number(d.issuedAtMs) !== 0) {
                        if ($util.Long)
                            m.issuedAtMs = $util.Long.fromValue(d.issuedAtMs, true);
                        else if (typeof d.issuedAtMs === "string")
                            m.issuedAtMs = $parseInt(d.issuedAtMs, 10);
                        else if (typeof d.issuedAtMs === "number")
                            m.issuedAtMs = d.issuedAtMs;
                        else if (typeof d.issuedAtMs === "object")
                            m.issuedAtMs = new $util.LongBits(d.issuedAtMs.low >>> 0, d.issuedAtMs.high >>> 0).toNumber(true);
                    }
                }
                if (d.expiresAtMs != null) {
                    if (typeof d.expiresAtMs === "object" ? d.expiresAtMs.low || d.expiresAtMs.high : $Number(d.expiresAtMs) !== 0) {
                        if ($util.Long)
                            m.expiresAtMs = $util.Long.fromValue(d.expiresAtMs, true);
                        else if (typeof d.expiresAtMs === "string")
                            m.expiresAtMs = $parseInt(d.expiresAtMs, 10);
                        else if (typeof d.expiresAtMs === "number")
                            m.expiresAtMs = d.expiresAtMs;
                        else if (typeof d.expiresAtMs === "object")
                            m.expiresAtMs = new $util.LongBits(d.expiresAtMs.low >>> 0, d.expiresAtMs.high >>> 0).toNumber(true);
                    }
                }
                if (d.label != null) {
                    if (typeof d.label !== "string" || d.label.length) {
                        m.label = $String(d.label);
                    }
                }
                if (d.capabilities != null) {
                    if ($Number(d.capabilities) !== 0) {
                        m.capabilities = d.capabilities >>> 0;
                    }
                }
                return m;
            };

            DeviceCertificate.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.defaults) {
                    if (o.bytes === $String)
                        d.deviceId = "";
                    else {
                        d.deviceId = [];
                        if (o.bytes !== $Array)
                            d.deviceId = $util.newBuffer(d.deviceId);
                    }
                    if (o.bytes === $String)
                        d.deviceSigningKey = "";
                    else {
                        d.deviceSigningKey = [];
                        if (o.bytes !== $Array)
                            d.deviceSigningKey = $util.newBuffer(d.deviceSigningKey);
                    }
                    if (o.bytes === $String)
                        d.deviceKemKey = "";
                    else {
                        d.deviceKemKey = [];
                        if (o.bytes !== $Array)
                            d.deviceKemKey = $util.newBuffer(d.deviceKemKey);
                    }
                    if ($util.Long) {
                        var n = new $util.Long(0, 0, true);
                        d.issuedAtMs = o.longs === $String ? n.toString() : o.longs === $Number ? n.toNumber() : typeof $BigInt !== "undefined" && o.longs === $BigInt ? n.toBigInt() : n;
                    } else
                        d.issuedAtMs = o.longs === $String ? "0" : typeof $BigInt !== "undefined" && o.longs === $BigInt ? $BigInt("0") : 0;
                    if ($util.Long) {
                        var n = new $util.Long(0, 0, true);
                        d.expiresAtMs = o.longs === $String ? n.toString() : o.longs === $Number ? n.toNumber() : typeof $BigInt !== "undefined" && o.longs === $BigInt ? n.toBigInt() : n;
                    } else
                        d.expiresAtMs = o.longs === $String ? "0" : typeof $BigInt !== "undefined" && o.longs === $BigInt ? $BigInt("0") : 0;
                    d.label = "";
                    d.capabilities = 0;
                }
                if (m.deviceId != null && $Object.hasOwnProperty.call(m, "deviceId")) {
                    d.deviceId = o.bytes === $String ? $util.base64.encode(m.deviceId, 0, m.deviceId.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.deviceId) : m.deviceId;
                }
                if (m.deviceSigningKey != null && $Object.hasOwnProperty.call(m, "deviceSigningKey")) {
                    d.deviceSigningKey = o.bytes === $String ? $util.base64.encode(m.deviceSigningKey, 0, m.deviceSigningKey.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.deviceSigningKey) : m.deviceSigningKey;
                }
                if (m.deviceKemKey != null && $Object.hasOwnProperty.call(m, "deviceKemKey")) {
                    d.deviceKemKey = o.bytes === $String ? $util.base64.encode(m.deviceKemKey, 0, m.deviceKemKey.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.deviceKemKey) : m.deviceKemKey;
                }
                if (m.issuedAtMs != null && $Object.hasOwnProperty.call(m, "issuedAtMs")) {
                    if (typeof $BigInt !== "undefined" && o.longs === $BigInt)
                        d.issuedAtMs = typeof m.issuedAtMs === "number" ? $BigInt(m.issuedAtMs) : $util.Long.fromBits(m.issuedAtMs.low >>> 0, m.issuedAtMs.high >>> 0, true).toBigInt();
                    else if (typeof m.issuedAtMs === "number")
                        d.issuedAtMs = o.longs === $String ? $String(m.issuedAtMs) : m.issuedAtMs;
                    else
                        d.issuedAtMs = o.longs === $String ? $util.Long.prototype.toString.call(m.issuedAtMs) : o.longs === $Number ? new $util.LongBits(m.issuedAtMs.low >>> 0, m.issuedAtMs.high >>> 0).toNumber(true) : m.issuedAtMs;
                }
                if (m.expiresAtMs != null && $Object.hasOwnProperty.call(m, "expiresAtMs")) {
                    if (typeof $BigInt !== "undefined" && o.longs === $BigInt)
                        d.expiresAtMs = typeof m.expiresAtMs === "number" ? $BigInt(m.expiresAtMs) : $util.Long.fromBits(m.expiresAtMs.low >>> 0, m.expiresAtMs.high >>> 0, true).toBigInt();
                    else if (typeof m.expiresAtMs === "number")
                        d.expiresAtMs = o.longs === $String ? $String(m.expiresAtMs) : m.expiresAtMs;
                    else
                        d.expiresAtMs = o.longs === $String ? $util.Long.prototype.toString.call(m.expiresAtMs) : o.longs === $Number ? new $util.LongBits(m.expiresAtMs.low >>> 0, m.expiresAtMs.high >>> 0).toNumber(true) : m.expiresAtMs;
                }
                if (m.label != null && $Object.hasOwnProperty.call(m, "label")) {
                    d.label = m.label;
                }
                if (m.capabilities != null && $Object.hasOwnProperty.call(m, "capabilities")) {
                    d.capabilities = m.capabilities;
                }
                return d;
            };

            DeviceCertificate.prototype.toJSON = function() {
                return DeviceCertificate.toObject(this, $protobuf.util.toJSONOptions);
            };

            DeviceCertificate.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.DeviceCertificate";
            };

            return DeviceCertificate;
        })();

        v1.ContactCapsule = (function() {

            const ContactCapsule = function (p) {
                this.cardLocators = [];
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            ContactCapsule.prototype.version = 0;
            ContactCapsule.prototype.fingerprint = $util.newBuffer([]);
            ContactCapsule.prototype.capsuleKey = $util.newBuffer([]);
            ContactCapsule.prototype.cardLocators = $util.emptyArray;
            ContactCapsule.prototype.expiresAtMs = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

            ContactCapsule.create = function(properties) {
                return new ContactCapsule(properties);
            };

            ContactCapsule.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.version != null && $Object.hasOwnProperty.call(m, "version") && m.version !== 0)
                    w.uint32(8).uint32(m.version);
                if (m.fingerprint != null && $Object.hasOwnProperty.call(m, "fingerprint") && m.fingerprint.length)
                    w.uint32(18).bytes(m.fingerprint);
                if (m.capsuleKey != null && $Object.hasOwnProperty.call(m, "capsuleKey") && m.capsuleKey.length)
                    w.uint32(26).bytes(m.capsuleKey);
                if (m.cardLocators != null && m.cardLocators.length) {
                    for (var i = 0; i < m.cardLocators.length; ++i)
                        $root.sma.v1.Locator.encode(m.cardLocators[i], w.uint32(34).fork(), q + 1).ldelim();
                }
                if (m.expiresAtMs != null && $Object.hasOwnProperty.call(m, "expiresAtMs") && (typeof m.expiresAtMs === "object" ? m.expiresAtMs.low || m.expiresAtMs.high : m.expiresAtMs !== 0))
                    w.uint32(40).uint64(m.expiresAtMs);
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            ContactCapsule.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.ContactCapsule();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 0)
                                break;
                            if (v = r.uint32())
                                m.version = v;
                            else
                                delete m.version;
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.fingerprint = v;
                            else
                                delete m.fingerprint;
                            continue;
                        }
                    case 3: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.capsuleKey = v;
                            else
                                delete m.capsuleKey;
                            continue;
                        }
                    case 4: {
                            if (u !== 2)
                                break;
                            if (!(m.cardLocators && m.cardLocators.length))
                                m.cardLocators = [];
                            m.cardLocators.push($root.sma.v1.Locator.decode(r, r.size(), $undefined, q + 1));
                            continue;
                        }
                    case 5: {
                            if (u !== 0)
                                break;
                            if (typeof (v = r.uint64()) === "object" ? v.low || v.high : v !== 0)
                                m.expiresAtMs = v;
                            else
                                delete m.expiresAtMs;
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            ContactCapsule.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.version != null && $Object.hasOwnProperty.call(m, "version")) {
                    if (!$util.isInteger(m.version))
                        return "version: integer expected";
                }
                if (m.fingerprint != null && $Object.hasOwnProperty.call(m, "fingerprint")) {
                    if (!(m.fingerprint && typeof m.fingerprint.length === "number" || $util.isString(m.fingerprint)))
                        return "fingerprint: buffer expected";
                }
                if (m.capsuleKey != null && $Object.hasOwnProperty.call(m, "capsuleKey")) {
                    if (!(m.capsuleKey && typeof m.capsuleKey.length === "number" || $util.isString(m.capsuleKey)))
                        return "capsuleKey: buffer expected";
                }
                if (m.cardLocators != null && $Object.hasOwnProperty.call(m, "cardLocators")) {
                    if (!$Array.isArray(m.cardLocators))
                        return "cardLocators: array expected";
                    for (var i = 0; i < m.cardLocators.length; ++i) {
                        {
                            var e = $root.sma.v1.Locator.verify(m.cardLocators[i], q + 1);
                            if (e)
                                return "cardLocators." + e;
                        }
                    }
                }
                if (m.expiresAtMs != null && $Object.hasOwnProperty.call(m, "expiresAtMs")) {
                    if (!$util.isInteger(m.expiresAtMs) && !(m.expiresAtMs && $util.isInteger(m.expiresAtMs.low) && $util.isInteger(m.expiresAtMs.high)))
                        return "expiresAtMs: integer|Long expected";
                }
                return null;
            };

            ContactCapsule.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.ContactCapsule)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.ContactCapsule: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.ContactCapsule();
                if (d.version != null) {
                    if ($Number(d.version) !== 0) {
                        m.version = d.version >>> 0;
                    }
                }
                if (d.fingerprint != null) {
                    if (d.fingerprint.length) {
                        if (typeof d.fingerprint === "string")
                            $util.base64.decode(d.fingerprint, m.fingerprint = $util.newBuffer($util.base64.length(d.fingerprint)), 0);
                        else if (d.fingerprint.length >= 0)
                            m.fingerprint = d.fingerprint;
                    }
                }
                if (d.capsuleKey != null) {
                    if (d.capsuleKey.length) {
                        if (typeof d.capsuleKey === "string")
                            $util.base64.decode(d.capsuleKey, m.capsuleKey = $util.newBuffer($util.base64.length(d.capsuleKey)), 0);
                        else if (d.capsuleKey.length >= 0)
                            m.capsuleKey = d.capsuleKey;
                    }
                }
                if (d.cardLocators) {
                    if (!$Array.isArray(d.cardLocators))
                        throw $TypeError(".sma.v1.ContactCapsule.cardLocators: array expected");
                    m.cardLocators = $Array(d.cardLocators.length);
                    for (var i = 0; i < d.cardLocators.length; ++i) {
                        if (!$util.isObject(d.cardLocators[i]))
                            throw $TypeError(".sma.v1.ContactCapsule.cardLocators: object expected");
                        m.cardLocators[i] = $root.sma.v1.Locator.fromObject(d.cardLocators[i], q + 1);
                    }
                }
                if (d.expiresAtMs != null) {
                    if (typeof d.expiresAtMs === "object" ? d.expiresAtMs.low || d.expiresAtMs.high : $Number(d.expiresAtMs) !== 0) {
                        if ($util.Long)
                            m.expiresAtMs = $util.Long.fromValue(d.expiresAtMs, true);
                        else if (typeof d.expiresAtMs === "string")
                            m.expiresAtMs = $parseInt(d.expiresAtMs, 10);
                        else if (typeof d.expiresAtMs === "number")
                            m.expiresAtMs = d.expiresAtMs;
                        else if (typeof d.expiresAtMs === "object")
                            m.expiresAtMs = new $util.LongBits(d.expiresAtMs.low >>> 0, d.expiresAtMs.high >>> 0).toNumber(true);
                    }
                }
                return m;
            };

            ContactCapsule.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.arrays || o.defaults) {
                    d.cardLocators = [];
                }
                if (o.defaults) {
                    d.version = 0;
                    if (o.bytes === $String)
                        d.fingerprint = "";
                    else {
                        d.fingerprint = [];
                        if (o.bytes !== $Array)
                            d.fingerprint = $util.newBuffer(d.fingerprint);
                    }
                    if (o.bytes === $String)
                        d.capsuleKey = "";
                    else {
                        d.capsuleKey = [];
                        if (o.bytes !== $Array)
                            d.capsuleKey = $util.newBuffer(d.capsuleKey);
                    }
                    if ($util.Long) {
                        var n = new $util.Long(0, 0, true);
                        d.expiresAtMs = o.longs === $String ? n.toString() : o.longs === $Number ? n.toNumber() : typeof $BigInt !== "undefined" && o.longs === $BigInt ? n.toBigInt() : n;
                    } else
                        d.expiresAtMs = o.longs === $String ? "0" : typeof $BigInt !== "undefined" && o.longs === $BigInt ? $BigInt("0") : 0;
                }
                if (m.version != null && $Object.hasOwnProperty.call(m, "version")) {
                    d.version = m.version;
                }
                if (m.fingerprint != null && $Object.hasOwnProperty.call(m, "fingerprint")) {
                    d.fingerprint = o.bytes === $String ? $util.base64.encode(m.fingerprint, 0, m.fingerprint.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.fingerprint) : m.fingerprint;
                }
                if (m.capsuleKey != null && $Object.hasOwnProperty.call(m, "capsuleKey")) {
                    d.capsuleKey = o.bytes === $String ? $util.base64.encode(m.capsuleKey, 0, m.capsuleKey.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.capsuleKey) : m.capsuleKey;
                }
                if (m.cardLocators && m.cardLocators.length) {
                    d.cardLocators = $Array(m.cardLocators.length);
                    for (var j = 0; j < m.cardLocators.length; ++j) {
                        d.cardLocators[j] = $root.sma.v1.Locator.toObject(m.cardLocators[j], o, q + 1);
                    }
                }
                if (m.expiresAtMs != null && $Object.hasOwnProperty.call(m, "expiresAtMs")) {
                    if (typeof $BigInt !== "undefined" && o.longs === $BigInt)
                        d.expiresAtMs = typeof m.expiresAtMs === "number" ? $BigInt(m.expiresAtMs) : $util.Long.fromBits(m.expiresAtMs.low >>> 0, m.expiresAtMs.high >>> 0, true).toBigInt();
                    else if (typeof m.expiresAtMs === "number")
                        d.expiresAtMs = o.longs === $String ? $String(m.expiresAtMs) : m.expiresAtMs;
                    else
                        d.expiresAtMs = o.longs === $String ? $util.Long.prototype.toString.call(m.expiresAtMs) : o.longs === $Number ? new $util.LongBits(m.expiresAtMs.low >>> 0, m.expiresAtMs.high >>> 0).toNumber(true) : m.expiresAtMs;
                }
                return d;
            };

            ContactCapsule.prototype.toJSON = function() {
                return ContactCapsule.toObject(this, $protobuf.util.toJSONOptions);
            };

            ContactCapsule.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.ContactCapsule";
            };

            return ContactCapsule;
        })();

        v1.ContactCard = (function() {

            const ContactCard = function (p) {
                this.inboxes = [];
                this.avatarLocators = [];
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            ContactCard.prototype.bundle = null;
            ContactCard.prototype.inboxTagKey = $util.newBuffer([]);
            ContactCard.prototype.inboxes = $util.emptyArray;
            ContactCard.prototype.oneTimePrekey = null;
            ContactCard.prototype.displayName = "";
            ContactCard.prototype.avatarSha256 = $util.newBuffer([]);
            ContactCard.prototype.avatarLocators = $util.emptyArray;

            ContactCard.create = function(properties) {
                return new ContactCard(properties);
            };

            ContactCard.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.bundle != null && $Object.hasOwnProperty.call(m, "bundle"))
                    $root.sma.v1.SignedBlob.encode(m.bundle, w.uint32(10).fork(), q + 1).ldelim();
                if (m.inboxTagKey != null && $Object.hasOwnProperty.call(m, "inboxTagKey") && m.inboxTagKey.length)
                    w.uint32(18).bytes(m.inboxTagKey);
                if (m.inboxes != null && m.inboxes.length) {
                    for (var i = 0; i < m.inboxes.length; ++i)
                        $root.sma.v1.MailboxAddress.encode(m.inboxes[i], w.uint32(26).fork(), q + 1).ldelim();
                }
                if (m.oneTimePrekey != null && $Object.hasOwnProperty.call(m, "oneTimePrekey"))
                    $root.sma.v1.SignedBlob.encode(m.oneTimePrekey, w.uint32(34).fork(), q + 1).ldelim();
                if (m.displayName != null && $Object.hasOwnProperty.call(m, "displayName") && m.displayName !== "")
                    w.uint32(42).string(m.displayName);
                if (m.avatarSha256 != null && $Object.hasOwnProperty.call(m, "avatarSha256") && m.avatarSha256.length)
                    w.uint32(50).bytes(m.avatarSha256);
                if (m.avatarLocators != null && m.avatarLocators.length) {
                    for (var i = 0; i < m.avatarLocators.length; ++i)
                        $root.sma.v1.Locator.encode(m.avatarLocators[i], w.uint32(58).fork(), q + 1).ldelim();
                }
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            ContactCard.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.ContactCard();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            m.bundle = $root.sma.v1.SignedBlob.decode(r, r.size(), $undefined, q + 1, m.bundle);
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.inboxTagKey = v;
                            else
                                delete m.inboxTagKey;
                            continue;
                        }
                    case 3: {
                            if (u !== 2)
                                break;
                            if (!(m.inboxes && m.inboxes.length))
                                m.inboxes = [];
                            m.inboxes.push($root.sma.v1.MailboxAddress.decode(r, r.size(), $undefined, q + 1));
                            continue;
                        }
                    case 4: {
                            if (u !== 2)
                                break;
                            m.oneTimePrekey = $root.sma.v1.SignedBlob.decode(r, r.size(), $undefined, q + 1, m.oneTimePrekey);
                            continue;
                        }
                    case 5: {
                            if (u !== 2)
                                break;
                            if ((v = r.stringVerify()).length)
                                m.displayName = v;
                            else
                                delete m.displayName;
                            continue;
                        }
                    case 6: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.avatarSha256 = v;
                            else
                                delete m.avatarSha256;
                            continue;
                        }
                    case 7: {
                            if (u !== 2)
                                break;
                            if (!(m.avatarLocators && m.avatarLocators.length))
                                m.avatarLocators = [];
                            m.avatarLocators.push($root.sma.v1.Locator.decode(r, r.size(), $undefined, q + 1));
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            ContactCard.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.bundle != null && $Object.hasOwnProperty.call(m, "bundle")) {
                    {
                        var e = $root.sma.v1.SignedBlob.verify(m.bundle, q + 1);
                        if (e)
                            return "bundle." + e;
                    }
                }
                if (m.inboxTagKey != null && $Object.hasOwnProperty.call(m, "inboxTagKey")) {
                    if (!(m.inboxTagKey && typeof m.inboxTagKey.length === "number" || $util.isString(m.inboxTagKey)))
                        return "inboxTagKey: buffer expected";
                }
                if (m.inboxes != null && $Object.hasOwnProperty.call(m, "inboxes")) {
                    if (!$Array.isArray(m.inboxes))
                        return "inboxes: array expected";
                    for (var i = 0; i < m.inboxes.length; ++i) {
                        {
                            var e = $root.sma.v1.MailboxAddress.verify(m.inboxes[i], q + 1);
                            if (e)
                                return "inboxes." + e;
                        }
                    }
                }
                if (m.oneTimePrekey != null && $Object.hasOwnProperty.call(m, "oneTimePrekey")) {
                    {
                        var e = $root.sma.v1.SignedBlob.verify(m.oneTimePrekey, q + 1);
                        if (e)
                            return "oneTimePrekey." + e;
                    }
                }
                if (m.displayName != null && $Object.hasOwnProperty.call(m, "displayName")) {
                    if (!$util.isString(m.displayName))
                        return "displayName: string expected";
                }
                if (m.avatarSha256 != null && $Object.hasOwnProperty.call(m, "avatarSha256")) {
                    if (!(m.avatarSha256 && typeof m.avatarSha256.length === "number" || $util.isString(m.avatarSha256)))
                        return "avatarSha256: buffer expected";
                }
                if (m.avatarLocators != null && $Object.hasOwnProperty.call(m, "avatarLocators")) {
                    if (!$Array.isArray(m.avatarLocators))
                        return "avatarLocators: array expected";
                    for (var i = 0; i < m.avatarLocators.length; ++i) {
                        {
                            var e = $root.sma.v1.Locator.verify(m.avatarLocators[i], q + 1);
                            if (e)
                                return "avatarLocators." + e;
                        }
                    }
                }
                return null;
            };

            ContactCard.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.ContactCard)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.ContactCard: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.ContactCard();
                if (d.bundle != null) {
                    if (!$util.isObject(d.bundle))
                        throw $TypeError(".sma.v1.ContactCard.bundle: object expected");
                    m.bundle = $root.sma.v1.SignedBlob.fromObject(d.bundle, q + 1);
                }
                if (d.inboxTagKey != null) {
                    if (d.inboxTagKey.length) {
                        if (typeof d.inboxTagKey === "string")
                            $util.base64.decode(d.inboxTagKey, m.inboxTagKey = $util.newBuffer($util.base64.length(d.inboxTagKey)), 0);
                        else if (d.inboxTagKey.length >= 0)
                            m.inboxTagKey = d.inboxTagKey;
                    }
                }
                if (d.inboxes) {
                    if (!$Array.isArray(d.inboxes))
                        throw $TypeError(".sma.v1.ContactCard.inboxes: array expected");
                    m.inboxes = $Array(d.inboxes.length);
                    for (var i = 0; i < d.inboxes.length; ++i) {
                        if (!$util.isObject(d.inboxes[i]))
                            throw $TypeError(".sma.v1.ContactCard.inboxes: object expected");
                        m.inboxes[i] = $root.sma.v1.MailboxAddress.fromObject(d.inboxes[i], q + 1);
                    }
                }
                if (d.oneTimePrekey != null) {
                    if (!$util.isObject(d.oneTimePrekey))
                        throw $TypeError(".sma.v1.ContactCard.oneTimePrekey: object expected");
                    m.oneTimePrekey = $root.sma.v1.SignedBlob.fromObject(d.oneTimePrekey, q + 1);
                }
                if (d.displayName != null) {
                    if (typeof d.displayName !== "string" || d.displayName.length) {
                        m.displayName = $String(d.displayName);
                    }
                }
                if (d.avatarSha256 != null) {
                    if (d.avatarSha256.length) {
                        if (typeof d.avatarSha256 === "string")
                            $util.base64.decode(d.avatarSha256, m.avatarSha256 = $util.newBuffer($util.base64.length(d.avatarSha256)), 0);
                        else if (d.avatarSha256.length >= 0)
                            m.avatarSha256 = d.avatarSha256;
                    }
                }
                if (d.avatarLocators) {
                    if (!$Array.isArray(d.avatarLocators))
                        throw $TypeError(".sma.v1.ContactCard.avatarLocators: array expected");
                    m.avatarLocators = $Array(d.avatarLocators.length);
                    for (var i = 0; i < d.avatarLocators.length; ++i) {
                        if (!$util.isObject(d.avatarLocators[i]))
                            throw $TypeError(".sma.v1.ContactCard.avatarLocators: object expected");
                        m.avatarLocators[i] = $root.sma.v1.Locator.fromObject(d.avatarLocators[i], q + 1);
                    }
                }
                return m;
            };

            ContactCard.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.arrays || o.defaults) {
                    d.inboxes = [];
                    d.avatarLocators = [];
                }
                if (o.defaults) {
                    d.bundle = null;
                    if (o.bytes === $String)
                        d.inboxTagKey = "";
                    else {
                        d.inboxTagKey = [];
                        if (o.bytes !== $Array)
                            d.inboxTagKey = $util.newBuffer(d.inboxTagKey);
                    }
                    d.oneTimePrekey = null;
                    d.displayName = "";
                    if (o.bytes === $String)
                        d.avatarSha256 = "";
                    else {
                        d.avatarSha256 = [];
                        if (o.bytes !== $Array)
                            d.avatarSha256 = $util.newBuffer(d.avatarSha256);
                    }
                }
                if (m.bundle != null && $Object.hasOwnProperty.call(m, "bundle")) {
                    d.bundle = $root.sma.v1.SignedBlob.toObject(m.bundle, o, q + 1);
                }
                if (m.inboxTagKey != null && $Object.hasOwnProperty.call(m, "inboxTagKey")) {
                    d.inboxTagKey = o.bytes === $String ? $util.base64.encode(m.inboxTagKey, 0, m.inboxTagKey.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.inboxTagKey) : m.inboxTagKey;
                }
                if (m.inboxes && m.inboxes.length) {
                    d.inboxes = $Array(m.inboxes.length);
                    for (var j = 0; j < m.inboxes.length; ++j) {
                        d.inboxes[j] = $root.sma.v1.MailboxAddress.toObject(m.inboxes[j], o, q + 1);
                    }
                }
                if (m.oneTimePrekey != null && $Object.hasOwnProperty.call(m, "oneTimePrekey")) {
                    d.oneTimePrekey = $root.sma.v1.SignedBlob.toObject(m.oneTimePrekey, o, q + 1);
                }
                if (m.displayName != null && $Object.hasOwnProperty.call(m, "displayName")) {
                    d.displayName = m.displayName;
                }
                if (m.avatarSha256 != null && $Object.hasOwnProperty.call(m, "avatarSha256")) {
                    d.avatarSha256 = o.bytes === $String ? $util.base64.encode(m.avatarSha256, 0, m.avatarSha256.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.avatarSha256) : m.avatarSha256;
                }
                if (m.avatarLocators && m.avatarLocators.length) {
                    d.avatarLocators = $Array(m.avatarLocators.length);
                    for (var j = 0; j < m.avatarLocators.length; ++j) {
                        d.avatarLocators[j] = $root.sma.v1.Locator.toObject(m.avatarLocators[j], o, q + 1);
                    }
                }
                return d;
            };

            ContactCard.prototype.toJSON = function() {
                return ContactCard.toObject(this, $protobuf.util.toJSONOptions);
            };

            ContactCard.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.ContactCard";
            };

            return ContactCard;
        })();

        v1.MailboxAddress = (function() {

            const MailboxAddress = function (p) {
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            MailboxAddress.prototype.nostr = null;
            MailboxAddress.prototype.telegram = null;
            MailboxAddress.prototype.matrix = null;

            let $oneOfFields;

            $Object.defineProperty(MailboxAddress.prototype, "kind", {
                get: $util.oneOfGetter($oneOfFields = ["nostr", "telegram", "matrix"]),
                set: $util.oneOfSetter($oneOfFields)
            });

            MailboxAddress.create = function(properties) {
                return new MailboxAddress(properties);
            };

            MailboxAddress.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.nostr != null && $Object.hasOwnProperty.call(m, "nostr"))
                    $root.sma.v1.NostrMailbox.encode(m.nostr, w.uint32(10).fork(), q + 1).ldelim();
                if (m.telegram != null && $Object.hasOwnProperty.call(m, "telegram"))
                    $root.sma.v1.TelegramMailbox.encode(m.telegram, w.uint32(18).fork(), q + 1).ldelim();
                if (m.matrix != null && $Object.hasOwnProperty.call(m, "matrix"))
                    $root.sma.v1.MatrixMailbox.encode(m.matrix, w.uint32(26).fork(), q + 1).ldelim();
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            MailboxAddress.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.MailboxAddress();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            m.nostr = $root.sma.v1.NostrMailbox.decode(r, r.size(), $undefined, q + 1, m.nostr);
                            m.kind = "nostr";
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            m.telegram = $root.sma.v1.TelegramMailbox.decode(r, r.size(), $undefined, q + 1, m.telegram);
                            m.kind = "telegram";
                            continue;
                        }
                    case 3: {
                            if (u !== 2)
                                break;
                            m.matrix = $root.sma.v1.MatrixMailbox.decode(r, r.size(), $undefined, q + 1, m.matrix);
                            m.kind = "matrix";
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            MailboxAddress.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                var p = {};
                if (m.nostr != null && $Object.hasOwnProperty.call(m, "nostr")) {
                    p.kind = 1;
                    {
                        var e = $root.sma.v1.NostrMailbox.verify(m.nostr, q + 1);
                        if (e)
                            return "nostr." + e;
                    }
                }
                if (m.telegram != null && $Object.hasOwnProperty.call(m, "telegram")) {
                    if (p.kind === 1)
                        return "kind: multiple values";
                    p.kind = 1;
                    {
                        var e = $root.sma.v1.TelegramMailbox.verify(m.telegram, q + 1);
                        if (e)
                            return "telegram." + e;
                    }
                }
                if (m.matrix != null && $Object.hasOwnProperty.call(m, "matrix")) {
                    if (p.kind === 1)
                        return "kind: multiple values";
                    p.kind = 1;
                    {
                        var e = $root.sma.v1.MatrixMailbox.verify(m.matrix, q + 1);
                        if (e)
                            return "matrix." + e;
                    }
                }
                return null;
            };

            MailboxAddress.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.MailboxAddress)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.MailboxAddress: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.MailboxAddress();
                if (d.nostr != null) {
                    if (!$util.isObject(d.nostr))
                        throw $TypeError(".sma.v1.MailboxAddress.nostr: object expected");
                    m.nostr = $root.sma.v1.NostrMailbox.fromObject(d.nostr, q + 1);
                }
                if (d.telegram != null) {
                    if (!$util.isObject(d.telegram))
                        throw $TypeError(".sma.v1.MailboxAddress.telegram: object expected");
                    m.telegram = $root.sma.v1.TelegramMailbox.fromObject(d.telegram, q + 1);
                }
                if (d.matrix != null) {
                    if (!$util.isObject(d.matrix))
                        throw $TypeError(".sma.v1.MailboxAddress.matrix: object expected");
                    m.matrix = $root.sma.v1.MatrixMailbox.fromObject(d.matrix, q + 1);
                }
                return m;
            };

            MailboxAddress.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (m.nostr != null && $Object.hasOwnProperty.call(m, "nostr")) {
                    d.nostr = $root.sma.v1.NostrMailbox.toObject(m.nostr, o, q + 1);
                    if (o.oneofs)
                        d.kind = "nostr";
                }
                if (m.telegram != null && $Object.hasOwnProperty.call(m, "telegram")) {
                    d.telegram = $root.sma.v1.TelegramMailbox.toObject(m.telegram, o, q + 1);
                    if (o.oneofs)
                        d.kind = "telegram";
                }
                if (m.matrix != null && $Object.hasOwnProperty.call(m, "matrix")) {
                    d.matrix = $root.sma.v1.MatrixMailbox.toObject(m.matrix, o, q + 1);
                    if (o.oneofs)
                        d.kind = "matrix";
                }
                return d;
            };

            MailboxAddress.prototype.toJSON = function() {
                return MailboxAddress.toObject(this, $protobuf.util.toJSONOptions);
            };

            MailboxAddress.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.MailboxAddress";
            };

            return MailboxAddress;
        })();

        v1.NostrMailbox = (function() {

            const NostrMailbox = function (p) {
                this.relays = [];
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            NostrMailbox.prototype.relays = $util.emptyArray;

            NostrMailbox.create = function(properties) {
                return new NostrMailbox(properties);
            };

            NostrMailbox.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.relays != null && m.relays.length) {
                    for (var i = 0; i < m.relays.length; ++i)
                        w.uint32(10).string(m.relays[i]);
                }
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            NostrMailbox.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.NostrMailbox();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            if (!(m.relays && m.relays.length))
                                m.relays = [];
                            m.relays.push(r.stringVerify());
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            NostrMailbox.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.relays != null && $Object.hasOwnProperty.call(m, "relays")) {
                    if (!$Array.isArray(m.relays))
                        return "relays: array expected";
                    for (var i = 0; i < m.relays.length; ++i) {
                        if (!$util.isString(m.relays[i]))
                            return "relays: string[] expected";
                    }
                }
                return null;
            };

            NostrMailbox.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.NostrMailbox)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.NostrMailbox: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.NostrMailbox();
                if (d.relays) {
                    if (!$Array.isArray(d.relays))
                        throw $TypeError(".sma.v1.NostrMailbox.relays: array expected");
                    m.relays = $Array(d.relays.length);
                    for (var i = 0; i < d.relays.length; ++i) {
                        m.relays[i] = $String(d.relays[i]);
                    }
                }
                return m;
            };

            NostrMailbox.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.arrays || o.defaults) {
                    d.relays = [];
                }
                if (m.relays && m.relays.length) {
                    d.relays = $Array(m.relays.length);
                    for (var j = 0; j < m.relays.length; ++j) {
                        d.relays[j] = m.relays[j];
                    }
                }
                return d;
            };

            NostrMailbox.prototype.toJSON = function() {
                return NostrMailbox.toObject(this, $protobuf.util.toJSONOptions);
            };

            NostrMailbox.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.NostrMailbox";
            };

            return NostrMailbox;
        })();

        v1.TelegramMailbox = (function() {

            const TelegramMailbox = function (p) {
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            TelegramMailbox.prototype.chatId = $util.Long ? $util.Long.fromBits(0,0,false) : 0;
            TelegramMailbox.prototype.inviteLink = "";

            TelegramMailbox.create = function(properties) {
                return new TelegramMailbox(properties);
            };

            TelegramMailbox.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.chatId != null && $Object.hasOwnProperty.call(m, "chatId") && (typeof m.chatId === "object" ? m.chatId.low || m.chatId.high : m.chatId !== 0))
                    w.uint32(8).int64(m.chatId);
                if (m.inviteLink != null && $Object.hasOwnProperty.call(m, "inviteLink") && m.inviteLink !== "")
                    w.uint32(18).string(m.inviteLink);
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            TelegramMailbox.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.TelegramMailbox();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 0)
                                break;
                            if (typeof (v = r.int64()) === "object" ? v.low || v.high : v !== 0)
                                m.chatId = v;
                            else
                                delete m.chatId;
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            if ((v = r.stringVerify()).length)
                                m.inviteLink = v;
                            else
                                delete m.inviteLink;
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            TelegramMailbox.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.chatId != null && $Object.hasOwnProperty.call(m, "chatId")) {
                    if (!$util.isInteger(m.chatId) && !(m.chatId && $util.isInteger(m.chatId.low) && $util.isInteger(m.chatId.high)))
                        return "chatId: integer|Long expected";
                }
                if (m.inviteLink != null && $Object.hasOwnProperty.call(m, "inviteLink")) {
                    if (!$util.isString(m.inviteLink))
                        return "inviteLink: string expected";
                }
                return null;
            };

            TelegramMailbox.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.TelegramMailbox)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.TelegramMailbox: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.TelegramMailbox();
                if (d.chatId != null) {
                    if (typeof d.chatId === "object" ? d.chatId.low || d.chatId.high : $Number(d.chatId) !== 0) {
                        if ($util.Long)
                            m.chatId = $util.Long.fromValue(d.chatId, false);
                        else if (typeof d.chatId === "string")
                            m.chatId = $parseInt(d.chatId, 10);
                        else if (typeof d.chatId === "number")
                            m.chatId = d.chatId;
                        else if (typeof d.chatId === "object")
                            m.chatId = new $util.LongBits(d.chatId.low >>> 0, d.chatId.high >>> 0).toNumber();
                    }
                }
                if (d.inviteLink != null) {
                    if (typeof d.inviteLink !== "string" || d.inviteLink.length) {
                        m.inviteLink = $String(d.inviteLink);
                    }
                }
                return m;
            };

            TelegramMailbox.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.defaults) {
                    if ($util.Long) {
                        var n = new $util.Long(0, 0, false);
                        d.chatId = o.longs === $String ? n.toString() : o.longs === $Number ? n.toNumber() : typeof $BigInt !== "undefined" && o.longs === $BigInt ? n.toBigInt() : n;
                    } else
                        d.chatId = o.longs === $String ? "0" : typeof $BigInt !== "undefined" && o.longs === $BigInt ? $BigInt("0") : 0;
                    d.inviteLink = "";
                }
                if (m.chatId != null && $Object.hasOwnProperty.call(m, "chatId")) {
                    if (typeof $BigInt !== "undefined" && o.longs === $BigInt)
                        d.chatId = typeof m.chatId === "number" ? $BigInt(m.chatId) : $util.Long.fromBits(m.chatId.low >>> 0, m.chatId.high >>> 0, false).toBigInt();
                    else if (typeof m.chatId === "number")
                        d.chatId = o.longs === $String ? $String(m.chatId) : m.chatId;
                    else
                        d.chatId = o.longs === $String ? $util.Long.prototype.toString.call(m.chatId) : o.longs === $Number ? new $util.LongBits(m.chatId.low >>> 0, m.chatId.high >>> 0).toNumber() : m.chatId;
                }
                if (m.inviteLink != null && $Object.hasOwnProperty.call(m, "inviteLink")) {
                    d.inviteLink = m.inviteLink;
                }
                return d;
            };

            TelegramMailbox.prototype.toJSON = function() {
                return TelegramMailbox.toObject(this, $protobuf.util.toJSONOptions);
            };

            TelegramMailbox.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.TelegramMailbox";
            };

            return TelegramMailbox;
        })();

        v1.MatrixMailbox = (function() {

            const MatrixMailbox = function (p) {
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            MatrixMailbox.prototype.roomId = "";
            MatrixMailbox.prototype.homeserver = "";

            MatrixMailbox.create = function(properties) {
                return new MatrixMailbox(properties);
            };

            MatrixMailbox.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.roomId != null && $Object.hasOwnProperty.call(m, "roomId") && m.roomId !== "")
                    w.uint32(10).string(m.roomId);
                if (m.homeserver != null && $Object.hasOwnProperty.call(m, "homeserver") && m.homeserver !== "")
                    w.uint32(18).string(m.homeserver);
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            MatrixMailbox.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.MatrixMailbox();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            if ((v = r.stringVerify()).length)
                                m.roomId = v;
                            else
                                delete m.roomId;
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            if ((v = r.stringVerify()).length)
                                m.homeserver = v;
                            else
                                delete m.homeserver;
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            MatrixMailbox.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.roomId != null && $Object.hasOwnProperty.call(m, "roomId")) {
                    if (!$util.isString(m.roomId))
                        return "roomId: string expected";
                }
                if (m.homeserver != null && $Object.hasOwnProperty.call(m, "homeserver")) {
                    if (!$util.isString(m.homeserver))
                        return "homeserver: string expected";
                }
                return null;
            };

            MatrixMailbox.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.MatrixMailbox)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.MatrixMailbox: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.MatrixMailbox();
                if (d.roomId != null) {
                    if (typeof d.roomId !== "string" || d.roomId.length) {
                        m.roomId = $String(d.roomId);
                    }
                }
                if (d.homeserver != null) {
                    if (typeof d.homeserver !== "string" || d.homeserver.length) {
                        m.homeserver = $String(d.homeserver);
                    }
                }
                return m;
            };

            MatrixMailbox.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.defaults) {
                    d.roomId = "";
                    d.homeserver = "";
                }
                if (m.roomId != null && $Object.hasOwnProperty.call(m, "roomId")) {
                    d.roomId = m.roomId;
                }
                if (m.homeserver != null && $Object.hasOwnProperty.call(m, "homeserver")) {
                    d.homeserver = m.homeserver;
                }
                return d;
            };

            MatrixMailbox.prototype.toJSON = function() {
                return MatrixMailbox.toObject(this, $protobuf.util.toJSONOptions);
            };

            MatrixMailbox.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.MatrixMailbox";
            };

            return MatrixMailbox;
        })();

        v1.Locator = (function() {

            const Locator = function (p) {
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            Locator.prototype.telegram = null;
            Locator.prototype.ipfsCid = null;
            Locator.prototype.blossom = null;
            Locator.prototype.https = null;
            Locator.prototype.webrtcPeer = null;
            Locator.prototype.nostr = null;

            let $oneOfFields;

            $Object.defineProperty(Locator.prototype, "where", {
                get: $util.oneOfGetter($oneOfFields = ["telegram", "ipfsCid", "blossom", "https", "webrtcPeer", "nostr"]),
                set: $util.oneOfSetter($oneOfFields)
            });

            Locator.create = function(properties) {
                return new Locator(properties);
            };

            Locator.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.telegram != null && $Object.hasOwnProperty.call(m, "telegram"))
                    w.uint32(10).string(m.telegram);
                if (m.ipfsCid != null && $Object.hasOwnProperty.call(m, "ipfsCid"))
                    w.uint32(18).string(m.ipfsCid);
                if (m.blossom != null && $Object.hasOwnProperty.call(m, "blossom"))
                    w.uint32(26).string(m.blossom);
                if (m.https != null && $Object.hasOwnProperty.call(m, "https"))
                    w.uint32(34).string(m.https);
                if (m.webrtcPeer != null && $Object.hasOwnProperty.call(m, "webrtcPeer"))
                    w.uint32(42).bytes(m.webrtcPeer);
                if (m.nostr != null && $Object.hasOwnProperty.call(m, "nostr"))
                    $root.sma.v1.NostrLocator.encode(m.nostr, w.uint32(50).fork(), q + 1).ldelim();
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            Locator.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.Locator();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            m.telegram = r.stringVerify();
                            m.where = "telegram";
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            m.ipfsCid = r.stringVerify();
                            m.where = "ipfsCid";
                            continue;
                        }
                    case 3: {
                            if (u !== 2)
                                break;
                            m.blossom = r.stringVerify();
                            m.where = "blossom";
                            continue;
                        }
                    case 4: {
                            if (u !== 2)
                                break;
                            m.https = r.stringVerify();
                            m.where = "https";
                            continue;
                        }
                    case 5: {
                            if (u !== 2)
                                break;
                            m.webrtcPeer = r.bytes();
                            m.where = "webrtcPeer";
                            continue;
                        }
                    case 6: {
                            if (u !== 2)
                                break;
                            m.nostr = $root.sma.v1.NostrLocator.decode(r, r.size(), $undefined, q + 1, m.nostr);
                            m.where = "nostr";
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            Locator.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                var p = {};
                if (m.telegram != null && $Object.hasOwnProperty.call(m, "telegram")) {
                    p.where = 1;
                    if (!$util.isString(m.telegram))
                        return "telegram: string expected";
                }
                if (m.ipfsCid != null && $Object.hasOwnProperty.call(m, "ipfsCid")) {
                    if (p.where === 1)
                        return "where: multiple values";
                    p.where = 1;
                    if (!$util.isString(m.ipfsCid))
                        return "ipfsCid: string expected";
                }
                if (m.blossom != null && $Object.hasOwnProperty.call(m, "blossom")) {
                    if (p.where === 1)
                        return "where: multiple values";
                    p.where = 1;
                    if (!$util.isString(m.blossom))
                        return "blossom: string expected";
                }
                if (m.https != null && $Object.hasOwnProperty.call(m, "https")) {
                    if (p.where === 1)
                        return "where: multiple values";
                    p.where = 1;
                    if (!$util.isString(m.https))
                        return "https: string expected";
                }
                if (m.webrtcPeer != null && $Object.hasOwnProperty.call(m, "webrtcPeer")) {
                    if (p.where === 1)
                        return "where: multiple values";
                    p.where = 1;
                    if (!(m.webrtcPeer && typeof m.webrtcPeer.length === "number" || $util.isString(m.webrtcPeer)))
                        return "webrtcPeer: buffer expected";
                }
                if (m.nostr != null && $Object.hasOwnProperty.call(m, "nostr")) {
                    if (p.where === 1)
                        return "where: multiple values";
                    p.where = 1;
                    {
                        var e = $root.sma.v1.NostrLocator.verify(m.nostr, q + 1);
                        if (e)
                            return "nostr." + e;
                    }
                }
                return null;
            };

            Locator.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.Locator)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.Locator: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.Locator();
                if (d.telegram != null) {
                    m.telegram = $String(d.telegram);
                }
                if (d.ipfsCid != null) {
                    m.ipfsCid = $String(d.ipfsCid);
                }
                if (d.blossom != null) {
                    m.blossom = $String(d.blossom);
                }
                if (d.https != null) {
                    m.https = $String(d.https);
                }
                if (d.webrtcPeer != null) {
                    if (typeof d.webrtcPeer === "string")
                        $util.base64.decode(d.webrtcPeer, m.webrtcPeer = $util.newBuffer($util.base64.length(d.webrtcPeer)), 0);
                    else if (d.webrtcPeer.length >= 0)
                        m.webrtcPeer = d.webrtcPeer;
                }
                if (d.nostr != null) {
                    if (!$util.isObject(d.nostr))
                        throw $TypeError(".sma.v1.Locator.nostr: object expected");
                    m.nostr = $root.sma.v1.NostrLocator.fromObject(d.nostr, q + 1);
                }
                return m;
            };

            Locator.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (m.telegram != null && $Object.hasOwnProperty.call(m, "telegram")) {
                    d.telegram = m.telegram;
                    if (o.oneofs)
                        d.where = "telegram";
                }
                if (m.ipfsCid != null && $Object.hasOwnProperty.call(m, "ipfsCid")) {
                    d.ipfsCid = m.ipfsCid;
                    if (o.oneofs)
                        d.where = "ipfsCid";
                }
                if (m.blossom != null && $Object.hasOwnProperty.call(m, "blossom")) {
                    d.blossom = m.blossom;
                    if (o.oneofs)
                        d.where = "blossom";
                }
                if (m.https != null && $Object.hasOwnProperty.call(m, "https")) {
                    d.https = m.https;
                    if (o.oneofs)
                        d.where = "https";
                }
                if (m.webrtcPeer != null && $Object.hasOwnProperty.call(m, "webrtcPeer")) {
                    d.webrtcPeer = o.bytes === $String ? $util.base64.encode(m.webrtcPeer, 0, m.webrtcPeer.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.webrtcPeer) : m.webrtcPeer;
                    if (o.oneofs)
                        d.where = "webrtcPeer";
                }
                if (m.nostr != null && $Object.hasOwnProperty.call(m, "nostr")) {
                    d.nostr = $root.sma.v1.NostrLocator.toObject(m.nostr, o, q + 1);
                    if (o.oneofs)
                        d.where = "nostr";
                }
                return d;
            };

            Locator.prototype.toJSON = function() {
                return Locator.toObject(this, $protobuf.util.toJSONOptions);
            };

            Locator.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.Locator";
            };

            return Locator;
        })();

        v1.NostrLocator = (function() {

            const NostrLocator = function (p) {
                this.relays = [];
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            NostrLocator.prototype.relays = $util.emptyArray;
            NostrLocator.prototype.tag = $util.newBuffer([]);

            NostrLocator.create = function(properties) {
                return new NostrLocator(properties);
            };

            NostrLocator.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.relays != null && m.relays.length) {
                    for (var i = 0; i < m.relays.length; ++i)
                        w.uint32(10).string(m.relays[i]);
                }
                if (m.tag != null && $Object.hasOwnProperty.call(m, "tag") && m.tag.length)
                    w.uint32(18).bytes(m.tag);
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            NostrLocator.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.NostrLocator();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            if (!(m.relays && m.relays.length))
                                m.relays = [];
                            m.relays.push(r.stringVerify());
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.tag = v;
                            else
                                delete m.tag;
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            NostrLocator.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.relays != null && $Object.hasOwnProperty.call(m, "relays")) {
                    if (!$Array.isArray(m.relays))
                        return "relays: array expected";
                    for (var i = 0; i < m.relays.length; ++i) {
                        if (!$util.isString(m.relays[i]))
                            return "relays: string[] expected";
                    }
                }
                if (m.tag != null && $Object.hasOwnProperty.call(m, "tag")) {
                    if (!(m.tag && typeof m.tag.length === "number" || $util.isString(m.tag)))
                        return "tag: buffer expected";
                }
                return null;
            };

            NostrLocator.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.NostrLocator)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.NostrLocator: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.NostrLocator();
                if (d.relays) {
                    if (!$Array.isArray(d.relays))
                        throw $TypeError(".sma.v1.NostrLocator.relays: array expected");
                    m.relays = $Array(d.relays.length);
                    for (var i = 0; i < d.relays.length; ++i) {
                        m.relays[i] = $String(d.relays[i]);
                    }
                }
                if (d.tag != null) {
                    if (d.tag.length) {
                        if (typeof d.tag === "string")
                            $util.base64.decode(d.tag, m.tag = $util.newBuffer($util.base64.length(d.tag)), 0);
                        else if (d.tag.length >= 0)
                            m.tag = d.tag;
                    }
                }
                return m;
            };

            NostrLocator.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.arrays || o.defaults) {
                    d.relays = [];
                }
                if (o.defaults) {
                    if (o.bytes === $String)
                        d.tag = "";
                    else {
                        d.tag = [];
                        if (o.bytes !== $Array)
                            d.tag = $util.newBuffer(d.tag);
                    }
                }
                if (m.relays && m.relays.length) {
                    d.relays = $Array(m.relays.length);
                    for (var j = 0; j < m.relays.length; ++j) {
                        d.relays[j] = m.relays[j];
                    }
                }
                if (m.tag != null && $Object.hasOwnProperty.call(m, "tag")) {
                    d.tag = o.bytes === $String ? $util.base64.encode(m.tag, 0, m.tag.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.tag) : m.tag;
                }
                return d;
            };

            NostrLocator.prototype.toJSON = function() {
                return NostrLocator.toObject(this, $protobuf.util.toJSONOptions);
            };

            NostrLocator.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.NostrLocator";
            };

            return NostrLocator;
        })();

        v1.Content = (function() {

            const Content = function (p) {
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            Content.prototype.messageId = $util.newBuffer([]);
            Content.prototype.sentAtMs = $util.Long ? $util.Long.fromBits(0,0,true) : 0;
            Content.prototype.expireAfterS = 0;
            Content.prototype.replyTo = $util.newBuffer([]);
            Content.prototype.groupId = $util.newBuffer([]);
            Content.prototype.text = null;
            Content.prototype.file = null;
            Content.prototype.call = null;
            Content.prototype.groupKey = null;
            Content.prototype.receipt = null;
            Content.prototype.reaction = null;
            Content.prototype.edit = null;
            Content.prototype["delete"] = null;
            Content.prototype.typing = null;
            Content.prototype.groupControl = null;
            Content.prototype.deviceSync = null;
            Content.prototype.prekeyRefresh = null;
            Content.prototype.plugin = null;
            Content.prototype.contactCard = null;

            let $oneOfFields;

            $Object.defineProperty(Content.prototype, "body", {
                get: $util.oneOfGetter($oneOfFields = ["text", "file", "call", "groupKey", "receipt", "reaction", "edit", "delete", "typing", "groupControl", "deviceSync", "prekeyRefresh", "plugin", "contactCard"]),
                set: $util.oneOfSetter($oneOfFields)
            });

            Content.create = function(properties) {
                return new Content(properties);
            };

            Content.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.messageId != null && $Object.hasOwnProperty.call(m, "messageId") && m.messageId.length)
                    w.uint32(10).bytes(m.messageId);
                if (m.sentAtMs != null && $Object.hasOwnProperty.call(m, "sentAtMs") && (typeof m.sentAtMs === "object" ? m.sentAtMs.low || m.sentAtMs.high : m.sentAtMs !== 0))
                    w.uint32(16).uint64(m.sentAtMs);
                if (m.expireAfterS != null && $Object.hasOwnProperty.call(m, "expireAfterS") && m.expireAfterS !== 0)
                    w.uint32(24).uint32(m.expireAfterS);
                if (m.replyTo != null && $Object.hasOwnProperty.call(m, "replyTo") && m.replyTo.length)
                    w.uint32(34).bytes(m.replyTo);
                if (m.groupId != null && $Object.hasOwnProperty.call(m, "groupId") && m.groupId.length)
                    w.uint32(42).bytes(m.groupId);
                if (m.text != null && $Object.hasOwnProperty.call(m, "text"))
                    $root.sma.v1.Text.encode(m.text, w.uint32(82).fork(), q + 1).ldelim();
                if (m.file != null && $Object.hasOwnProperty.call(m, "file"))
                    $root.sma.v1.FileManifest.encode(m.file, w.uint32(90).fork(), q + 1).ldelim();
                if (m.call != null && $Object.hasOwnProperty.call(m, "call"))
                    $root.sma.v1.CallSignal.encode(m.call, w.uint32(98).fork(), q + 1).ldelim();
                if (m.groupKey != null && $Object.hasOwnProperty.call(m, "groupKey"))
                    $root.sma.v1.GroupKeyDistribution.encode(m.groupKey, w.uint32(106).fork(), q + 1).ldelim();
                if (m.receipt != null && $Object.hasOwnProperty.call(m, "receipt"))
                    $root.sma.v1.Receipt.encode(m.receipt, w.uint32(114).fork(), q + 1).ldelim();
                if (m.reaction != null && $Object.hasOwnProperty.call(m, "reaction"))
                    $root.sma.v1.Reaction.encode(m.reaction, w.uint32(122).fork(), q + 1).ldelim();
                if (m.edit != null && $Object.hasOwnProperty.call(m, "edit"))
                    $root.sma.v1.Edit.encode(m.edit, w.uint32(130).fork(), q + 1).ldelim();
                if (m["delete"] != null && $Object.hasOwnProperty.call(m, "delete"))
                    $root.sma.v1.Delete.encode(m["delete"], w.uint32(138).fork(), q + 1).ldelim();
                if (m.typing != null && $Object.hasOwnProperty.call(m, "typing"))
                    $root.sma.v1.Typing.encode(m.typing, w.uint32(146).fork(), q + 1).ldelim();
                if (m.groupControl != null && $Object.hasOwnProperty.call(m, "groupControl"))
                    $root.sma.v1.GroupControl.encode(m.groupControl, w.uint32(154).fork(), q + 1).ldelim();
                if (m.deviceSync != null && $Object.hasOwnProperty.call(m, "deviceSync"))
                    $root.sma.v1.DeviceSync.encode(m.deviceSync, w.uint32(162).fork(), q + 1).ldelim();
                if (m.prekeyRefresh != null && $Object.hasOwnProperty.call(m, "prekeyRefresh"))
                    $root.sma.v1.PrekeyRefresh.encode(m.prekeyRefresh, w.uint32(170).fork(), q + 1).ldelim();
                if (m.plugin != null && $Object.hasOwnProperty.call(m, "plugin"))
                    $root.sma.v1.PluginMessage.encode(m.plugin, w.uint32(178).fork(), q + 1).ldelim();
                if (m.contactCard != null && $Object.hasOwnProperty.call(m, "contactCard"))
                    $root.sma.v1.ContactCard.encode(m.contactCard, w.uint32(186).fork(), q + 1).ldelim();
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            Content.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.Content();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.messageId = v;
                            else
                                delete m.messageId;
                            continue;
                        }
                    case 2: {
                            if (u !== 0)
                                break;
                            if (typeof (v = r.uint64()) === "object" ? v.low || v.high : v !== 0)
                                m.sentAtMs = v;
                            else
                                delete m.sentAtMs;
                            continue;
                        }
                    case 3: {
                            if (u !== 0)
                                break;
                            if (v = r.uint32())
                                m.expireAfterS = v;
                            else
                                delete m.expireAfterS;
                            continue;
                        }
                    case 4: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.replyTo = v;
                            else
                                delete m.replyTo;
                            continue;
                        }
                    case 5: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.groupId = v;
                            else
                                delete m.groupId;
                            continue;
                        }
                    case 10: {
                            if (u !== 2)
                                break;
                            m.text = $root.sma.v1.Text.decode(r, r.size(), $undefined, q + 1, m.text);
                            m.body = "text";
                            continue;
                        }
                    case 11: {
                            if (u !== 2)
                                break;
                            m.file = $root.sma.v1.FileManifest.decode(r, r.size(), $undefined, q + 1, m.file);
                            m.body = "file";
                            continue;
                        }
                    case 12: {
                            if (u !== 2)
                                break;
                            m.call = $root.sma.v1.CallSignal.decode(r, r.size(), $undefined, q + 1, m.call);
                            m.body = "call";
                            continue;
                        }
                    case 13: {
                            if (u !== 2)
                                break;
                            m.groupKey = $root.sma.v1.GroupKeyDistribution.decode(r, r.size(), $undefined, q + 1, m.groupKey);
                            m.body = "groupKey";
                            continue;
                        }
                    case 14: {
                            if (u !== 2)
                                break;
                            m.receipt = $root.sma.v1.Receipt.decode(r, r.size(), $undefined, q + 1, m.receipt);
                            m.body = "receipt";
                            continue;
                        }
                    case 15: {
                            if (u !== 2)
                                break;
                            m.reaction = $root.sma.v1.Reaction.decode(r, r.size(), $undefined, q + 1, m.reaction);
                            m.body = "reaction";
                            continue;
                        }
                    case 16: {
                            if (u !== 2)
                                break;
                            m.edit = $root.sma.v1.Edit.decode(r, r.size(), $undefined, q + 1, m.edit);
                            m.body = "edit";
                            continue;
                        }
                    case 17: {
                            if (u !== 2)
                                break;
                            m["delete"] = $root.sma.v1.Delete.decode(r, r.size(), $undefined, q + 1, m["delete"]);
                            m.body = "delete";
                            continue;
                        }
                    case 18: {
                            if (u !== 2)
                                break;
                            m.typing = $root.sma.v1.Typing.decode(r, r.size(), $undefined, q + 1, m.typing);
                            m.body = "typing";
                            continue;
                        }
                    case 19: {
                            if (u !== 2)
                                break;
                            m.groupControl = $root.sma.v1.GroupControl.decode(r, r.size(), $undefined, q + 1, m.groupControl);
                            m.body = "groupControl";
                            continue;
                        }
                    case 20: {
                            if (u !== 2)
                                break;
                            m.deviceSync = $root.sma.v1.DeviceSync.decode(r, r.size(), $undefined, q + 1, m.deviceSync);
                            m.body = "deviceSync";
                            continue;
                        }
                    case 21: {
                            if (u !== 2)
                                break;
                            m.prekeyRefresh = $root.sma.v1.PrekeyRefresh.decode(r, r.size(), $undefined, q + 1, m.prekeyRefresh);
                            m.body = "prekeyRefresh";
                            continue;
                        }
                    case 22: {
                            if (u !== 2)
                                break;
                            m.plugin = $root.sma.v1.PluginMessage.decode(r, r.size(), $undefined, q + 1, m.plugin);
                            m.body = "plugin";
                            continue;
                        }
                    case 23: {
                            if (u !== 2)
                                break;
                            m.contactCard = $root.sma.v1.ContactCard.decode(r, r.size(), $undefined, q + 1, m.contactCard);
                            m.body = "contactCard";
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            Content.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                var p = {};
                if (m.messageId != null && $Object.hasOwnProperty.call(m, "messageId")) {
                    if (!(m.messageId && typeof m.messageId.length === "number" || $util.isString(m.messageId)))
                        return "messageId: buffer expected";
                }
                if (m.sentAtMs != null && $Object.hasOwnProperty.call(m, "sentAtMs")) {
                    if (!$util.isInteger(m.sentAtMs) && !(m.sentAtMs && $util.isInteger(m.sentAtMs.low) && $util.isInteger(m.sentAtMs.high)))
                        return "sentAtMs: integer|Long expected";
                }
                if (m.expireAfterS != null && $Object.hasOwnProperty.call(m, "expireAfterS")) {
                    if (!$util.isInteger(m.expireAfterS))
                        return "expireAfterS: integer expected";
                }
                if (m.replyTo != null && $Object.hasOwnProperty.call(m, "replyTo")) {
                    if (!(m.replyTo && typeof m.replyTo.length === "number" || $util.isString(m.replyTo)))
                        return "replyTo: buffer expected";
                }
                if (m.groupId != null && $Object.hasOwnProperty.call(m, "groupId")) {
                    if (!(m.groupId && typeof m.groupId.length === "number" || $util.isString(m.groupId)))
                        return "groupId: buffer expected";
                }
                if (m.text != null && $Object.hasOwnProperty.call(m, "text")) {
                    p.body = 1;
                    {
                        var e = $root.sma.v1.Text.verify(m.text, q + 1);
                        if (e)
                            return "text." + e;
                    }
                }
                if (m.file != null && $Object.hasOwnProperty.call(m, "file")) {
                    if (p.body === 1)
                        return "body: multiple values";
                    p.body = 1;
                    {
                        var e = $root.sma.v1.FileManifest.verify(m.file, q + 1);
                        if (e)
                            return "file." + e;
                    }
                }
                if (m.call != null && $Object.hasOwnProperty.call(m, "call")) {
                    if (p.body === 1)
                        return "body: multiple values";
                    p.body = 1;
                    {
                        var e = $root.sma.v1.CallSignal.verify(m.call, q + 1);
                        if (e)
                            return "call." + e;
                    }
                }
                if (m.groupKey != null && $Object.hasOwnProperty.call(m, "groupKey")) {
                    if (p.body === 1)
                        return "body: multiple values";
                    p.body = 1;
                    {
                        var e = $root.sma.v1.GroupKeyDistribution.verify(m.groupKey, q + 1);
                        if (e)
                            return "groupKey." + e;
                    }
                }
                if (m.receipt != null && $Object.hasOwnProperty.call(m, "receipt")) {
                    if (p.body === 1)
                        return "body: multiple values";
                    p.body = 1;
                    {
                        var e = $root.sma.v1.Receipt.verify(m.receipt, q + 1);
                        if (e)
                            return "receipt." + e;
                    }
                }
                if (m.reaction != null && $Object.hasOwnProperty.call(m, "reaction")) {
                    if (p.body === 1)
                        return "body: multiple values";
                    p.body = 1;
                    {
                        var e = $root.sma.v1.Reaction.verify(m.reaction, q + 1);
                        if (e)
                            return "reaction." + e;
                    }
                }
                if (m.edit != null && $Object.hasOwnProperty.call(m, "edit")) {
                    if (p.body === 1)
                        return "body: multiple values";
                    p.body = 1;
                    {
                        var e = $root.sma.v1.Edit.verify(m.edit, q + 1);
                        if (e)
                            return "edit." + e;
                    }
                }
                if (m["delete"] != null && $Object.hasOwnProperty.call(m, "delete")) {
                    if (p.body === 1)
                        return "body: multiple values";
                    p.body = 1;
                    {
                        var e = $root.sma.v1.Delete.verify(m["delete"], q + 1);
                        if (e)
                            return "delete." + e;
                    }
                }
                if (m.typing != null && $Object.hasOwnProperty.call(m, "typing")) {
                    if (p.body === 1)
                        return "body: multiple values";
                    p.body = 1;
                    {
                        var e = $root.sma.v1.Typing.verify(m.typing, q + 1);
                        if (e)
                            return "typing." + e;
                    }
                }
                if (m.groupControl != null && $Object.hasOwnProperty.call(m, "groupControl")) {
                    if (p.body === 1)
                        return "body: multiple values";
                    p.body = 1;
                    {
                        var e = $root.sma.v1.GroupControl.verify(m.groupControl, q + 1);
                        if (e)
                            return "groupControl." + e;
                    }
                }
                if (m.deviceSync != null && $Object.hasOwnProperty.call(m, "deviceSync")) {
                    if (p.body === 1)
                        return "body: multiple values";
                    p.body = 1;
                    {
                        var e = $root.sma.v1.DeviceSync.verify(m.deviceSync, q + 1);
                        if (e)
                            return "deviceSync." + e;
                    }
                }
                if (m.prekeyRefresh != null && $Object.hasOwnProperty.call(m, "prekeyRefresh")) {
                    if (p.body === 1)
                        return "body: multiple values";
                    p.body = 1;
                    {
                        var e = $root.sma.v1.PrekeyRefresh.verify(m.prekeyRefresh, q + 1);
                        if (e)
                            return "prekeyRefresh." + e;
                    }
                }
                if (m.plugin != null && $Object.hasOwnProperty.call(m, "plugin")) {
                    if (p.body === 1)
                        return "body: multiple values";
                    p.body = 1;
                    {
                        var e = $root.sma.v1.PluginMessage.verify(m.plugin, q + 1);
                        if (e)
                            return "plugin." + e;
                    }
                }
                if (m.contactCard != null && $Object.hasOwnProperty.call(m, "contactCard")) {
                    if (p.body === 1)
                        return "body: multiple values";
                    p.body = 1;
                    {
                        var e = $root.sma.v1.ContactCard.verify(m.contactCard, q + 1);
                        if (e)
                            return "contactCard." + e;
                    }
                }
                return null;
            };

            Content.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.Content)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.Content: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.Content();
                if (d.messageId != null) {
                    if (d.messageId.length) {
                        if (typeof d.messageId === "string")
                            $util.base64.decode(d.messageId, m.messageId = $util.newBuffer($util.base64.length(d.messageId)), 0);
                        else if (d.messageId.length >= 0)
                            m.messageId = d.messageId;
                    }
                }
                if (d.sentAtMs != null) {
                    if (typeof d.sentAtMs === "object" ? d.sentAtMs.low || d.sentAtMs.high : $Number(d.sentAtMs) !== 0) {
                        if ($util.Long)
                            m.sentAtMs = $util.Long.fromValue(d.sentAtMs, true);
                        else if (typeof d.sentAtMs === "string")
                            m.sentAtMs = $parseInt(d.sentAtMs, 10);
                        else if (typeof d.sentAtMs === "number")
                            m.sentAtMs = d.sentAtMs;
                        else if (typeof d.sentAtMs === "object")
                            m.sentAtMs = new $util.LongBits(d.sentAtMs.low >>> 0, d.sentAtMs.high >>> 0).toNumber(true);
                    }
                }
                if (d.expireAfterS != null) {
                    if ($Number(d.expireAfterS) !== 0) {
                        m.expireAfterS = d.expireAfterS >>> 0;
                    }
                }
                if (d.replyTo != null) {
                    if (d.replyTo.length) {
                        if (typeof d.replyTo === "string")
                            $util.base64.decode(d.replyTo, m.replyTo = $util.newBuffer($util.base64.length(d.replyTo)), 0);
                        else if (d.replyTo.length >= 0)
                            m.replyTo = d.replyTo;
                    }
                }
                if (d.groupId != null) {
                    if (d.groupId.length) {
                        if (typeof d.groupId === "string")
                            $util.base64.decode(d.groupId, m.groupId = $util.newBuffer($util.base64.length(d.groupId)), 0);
                        else if (d.groupId.length >= 0)
                            m.groupId = d.groupId;
                    }
                }
                if (d.text != null) {
                    if (!$util.isObject(d.text))
                        throw $TypeError(".sma.v1.Content.text: object expected");
                    m.text = $root.sma.v1.Text.fromObject(d.text, q + 1);
                }
                if (d.file != null) {
                    if (!$util.isObject(d.file))
                        throw $TypeError(".sma.v1.Content.file: object expected");
                    m.file = $root.sma.v1.FileManifest.fromObject(d.file, q + 1);
                }
                if (d.call != null) {
                    if (!$util.isObject(d.call))
                        throw $TypeError(".sma.v1.Content.call: object expected");
                    m.call = $root.sma.v1.CallSignal.fromObject(d.call, q + 1);
                }
                if (d.groupKey != null) {
                    if (!$util.isObject(d.groupKey))
                        throw $TypeError(".sma.v1.Content.groupKey: object expected");
                    m.groupKey = $root.sma.v1.GroupKeyDistribution.fromObject(d.groupKey, q + 1);
                }
                if (d.receipt != null) {
                    if (!$util.isObject(d.receipt))
                        throw $TypeError(".sma.v1.Content.receipt: object expected");
                    m.receipt = $root.sma.v1.Receipt.fromObject(d.receipt, q + 1);
                }
                if (d.reaction != null) {
                    if (!$util.isObject(d.reaction))
                        throw $TypeError(".sma.v1.Content.reaction: object expected");
                    m.reaction = $root.sma.v1.Reaction.fromObject(d.reaction, q + 1);
                }
                if (d.edit != null) {
                    if (!$util.isObject(d.edit))
                        throw $TypeError(".sma.v1.Content.edit: object expected");
                    m.edit = $root.sma.v1.Edit.fromObject(d.edit, q + 1);
                }
                if (d["delete"] != null) {
                    if (!$util.isObject(d["delete"]))
                        throw $TypeError(".sma.v1.Content.delete: object expected");
                    m["delete"] = $root.sma.v1.Delete.fromObject(d["delete"], q + 1);
                }
                if (d.typing != null) {
                    if (!$util.isObject(d.typing))
                        throw $TypeError(".sma.v1.Content.typing: object expected");
                    m.typing = $root.sma.v1.Typing.fromObject(d.typing, q + 1);
                }
                if (d.groupControl != null) {
                    if (!$util.isObject(d.groupControl))
                        throw $TypeError(".sma.v1.Content.groupControl: object expected");
                    m.groupControl = $root.sma.v1.GroupControl.fromObject(d.groupControl, q + 1);
                }
                if (d.deviceSync != null) {
                    if (!$util.isObject(d.deviceSync))
                        throw $TypeError(".sma.v1.Content.deviceSync: object expected");
                    m.deviceSync = $root.sma.v1.DeviceSync.fromObject(d.deviceSync, q + 1);
                }
                if (d.prekeyRefresh != null) {
                    if (!$util.isObject(d.prekeyRefresh))
                        throw $TypeError(".sma.v1.Content.prekeyRefresh: object expected");
                    m.prekeyRefresh = $root.sma.v1.PrekeyRefresh.fromObject(d.prekeyRefresh, q + 1);
                }
                if (d.plugin != null) {
                    if (!$util.isObject(d.plugin))
                        throw $TypeError(".sma.v1.Content.plugin: object expected");
                    m.plugin = $root.sma.v1.PluginMessage.fromObject(d.plugin, q + 1);
                }
                if (d.contactCard != null) {
                    if (!$util.isObject(d.contactCard))
                        throw $TypeError(".sma.v1.Content.contactCard: object expected");
                    m.contactCard = $root.sma.v1.ContactCard.fromObject(d.contactCard, q + 1);
                }
                return m;
            };

            Content.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.defaults) {
                    if (o.bytes === $String)
                        d.messageId = "";
                    else {
                        d.messageId = [];
                        if (o.bytes !== $Array)
                            d.messageId = $util.newBuffer(d.messageId);
                    }
                    if ($util.Long) {
                        var n = new $util.Long(0, 0, true);
                        d.sentAtMs = o.longs === $String ? n.toString() : o.longs === $Number ? n.toNumber() : typeof $BigInt !== "undefined" && o.longs === $BigInt ? n.toBigInt() : n;
                    } else
                        d.sentAtMs = o.longs === $String ? "0" : typeof $BigInt !== "undefined" && o.longs === $BigInt ? $BigInt("0") : 0;
                    d.expireAfterS = 0;
                    if (o.bytes === $String)
                        d.replyTo = "";
                    else {
                        d.replyTo = [];
                        if (o.bytes !== $Array)
                            d.replyTo = $util.newBuffer(d.replyTo);
                    }
                    if (o.bytes === $String)
                        d.groupId = "";
                    else {
                        d.groupId = [];
                        if (o.bytes !== $Array)
                            d.groupId = $util.newBuffer(d.groupId);
                    }
                }
                if (m.messageId != null && $Object.hasOwnProperty.call(m, "messageId")) {
                    d.messageId = o.bytes === $String ? $util.base64.encode(m.messageId, 0, m.messageId.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.messageId) : m.messageId;
                }
                if (m.sentAtMs != null && $Object.hasOwnProperty.call(m, "sentAtMs")) {
                    if (typeof $BigInt !== "undefined" && o.longs === $BigInt)
                        d.sentAtMs = typeof m.sentAtMs === "number" ? $BigInt(m.sentAtMs) : $util.Long.fromBits(m.sentAtMs.low >>> 0, m.sentAtMs.high >>> 0, true).toBigInt();
                    else if (typeof m.sentAtMs === "number")
                        d.sentAtMs = o.longs === $String ? $String(m.sentAtMs) : m.sentAtMs;
                    else
                        d.sentAtMs = o.longs === $String ? $util.Long.prototype.toString.call(m.sentAtMs) : o.longs === $Number ? new $util.LongBits(m.sentAtMs.low >>> 0, m.sentAtMs.high >>> 0).toNumber(true) : m.sentAtMs;
                }
                if (m.expireAfterS != null && $Object.hasOwnProperty.call(m, "expireAfterS")) {
                    d.expireAfterS = m.expireAfterS;
                }
                if (m.replyTo != null && $Object.hasOwnProperty.call(m, "replyTo")) {
                    d.replyTo = o.bytes === $String ? $util.base64.encode(m.replyTo, 0, m.replyTo.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.replyTo) : m.replyTo;
                }
                if (m.groupId != null && $Object.hasOwnProperty.call(m, "groupId")) {
                    d.groupId = o.bytes === $String ? $util.base64.encode(m.groupId, 0, m.groupId.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.groupId) : m.groupId;
                }
                if (m.text != null && $Object.hasOwnProperty.call(m, "text")) {
                    d.text = $root.sma.v1.Text.toObject(m.text, o, q + 1);
                    if (o.oneofs)
                        d.body = "text";
                }
                if (m.file != null && $Object.hasOwnProperty.call(m, "file")) {
                    d.file = $root.sma.v1.FileManifest.toObject(m.file, o, q + 1);
                    if (o.oneofs)
                        d.body = "file";
                }
                if (m.call != null && $Object.hasOwnProperty.call(m, "call")) {
                    d.call = $root.sma.v1.CallSignal.toObject(m.call, o, q + 1);
                    if (o.oneofs)
                        d.body = "call";
                }
                if (m.groupKey != null && $Object.hasOwnProperty.call(m, "groupKey")) {
                    d.groupKey = $root.sma.v1.GroupKeyDistribution.toObject(m.groupKey, o, q + 1);
                    if (o.oneofs)
                        d.body = "groupKey";
                }
                if (m.receipt != null && $Object.hasOwnProperty.call(m, "receipt")) {
                    d.receipt = $root.sma.v1.Receipt.toObject(m.receipt, o, q + 1);
                    if (o.oneofs)
                        d.body = "receipt";
                }
                if (m.reaction != null && $Object.hasOwnProperty.call(m, "reaction")) {
                    d.reaction = $root.sma.v1.Reaction.toObject(m.reaction, o, q + 1);
                    if (o.oneofs)
                        d.body = "reaction";
                }
                if (m.edit != null && $Object.hasOwnProperty.call(m, "edit")) {
                    d.edit = $root.sma.v1.Edit.toObject(m.edit, o, q + 1);
                    if (o.oneofs)
                        d.body = "edit";
                }
                if (m["delete"] != null && $Object.hasOwnProperty.call(m, "delete")) {
                    d["delete"] = $root.sma.v1.Delete.toObject(m["delete"], o, q + 1);
                    if (o.oneofs)
                        d.body = "delete";
                }
                if (m.typing != null && $Object.hasOwnProperty.call(m, "typing")) {
                    d.typing = $root.sma.v1.Typing.toObject(m.typing, o, q + 1);
                    if (o.oneofs)
                        d.body = "typing";
                }
                if (m.groupControl != null && $Object.hasOwnProperty.call(m, "groupControl")) {
                    d.groupControl = $root.sma.v1.GroupControl.toObject(m.groupControl, o, q + 1);
                    if (o.oneofs)
                        d.body = "groupControl";
                }
                if (m.deviceSync != null && $Object.hasOwnProperty.call(m, "deviceSync")) {
                    d.deviceSync = $root.sma.v1.DeviceSync.toObject(m.deviceSync, o, q + 1);
                    if (o.oneofs)
                        d.body = "deviceSync";
                }
                if (m.prekeyRefresh != null && $Object.hasOwnProperty.call(m, "prekeyRefresh")) {
                    d.prekeyRefresh = $root.sma.v1.PrekeyRefresh.toObject(m.prekeyRefresh, o, q + 1);
                    if (o.oneofs)
                        d.body = "prekeyRefresh";
                }
                if (m.plugin != null && $Object.hasOwnProperty.call(m, "plugin")) {
                    d.plugin = $root.sma.v1.PluginMessage.toObject(m.plugin, o, q + 1);
                    if (o.oneofs)
                        d.body = "plugin";
                }
                if (m.contactCard != null && $Object.hasOwnProperty.call(m, "contactCard")) {
                    d.contactCard = $root.sma.v1.ContactCard.toObject(m.contactCard, o, q + 1);
                    if (o.oneofs)
                        d.body = "contactCard";
                }
                return d;
            };

            Content.prototype.toJSON = function() {
                return Content.toObject(this, $protobuf.util.toJSONOptions);
            };

            Content.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.Content";
            };

            return Content;
        })();

        v1.Text = (function() {

            const Text = function (p) {
                this.mentions = [];
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            Text.prototype.body = "";
            Text.prototype.mentions = $util.emptyArray;

            Text.create = function(properties) {
                return new Text(properties);
            };

            Text.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.body != null && $Object.hasOwnProperty.call(m, "body") && m.body !== "")
                    w.uint32(10).string(m.body);
                if (m.mentions != null && m.mentions.length) {
                    for (var i = 0; i < m.mentions.length; ++i)
                        $root.sma.v1.Mention.encode(m.mentions[i], w.uint32(18).fork(), q + 1).ldelim();
                }
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            Text.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.Text();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            if ((v = r.stringVerify()).length)
                                m.body = v;
                            else
                                delete m.body;
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            if (!(m.mentions && m.mentions.length))
                                m.mentions = [];
                            m.mentions.push($root.sma.v1.Mention.decode(r, r.size(), $undefined, q + 1));
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            Text.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.body != null && $Object.hasOwnProperty.call(m, "body")) {
                    if (!$util.isString(m.body))
                        return "body: string expected";
                }
                if (m.mentions != null && $Object.hasOwnProperty.call(m, "mentions")) {
                    if (!$Array.isArray(m.mentions))
                        return "mentions: array expected";
                    for (var i = 0; i < m.mentions.length; ++i) {
                        {
                            var e = $root.sma.v1.Mention.verify(m.mentions[i], q + 1);
                            if (e)
                                return "mentions." + e;
                        }
                    }
                }
                return null;
            };

            Text.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.Text)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.Text: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.Text();
                if (d.body != null) {
                    if (typeof d.body !== "string" || d.body.length) {
                        m.body = $String(d.body);
                    }
                }
                if (d.mentions) {
                    if (!$Array.isArray(d.mentions))
                        throw $TypeError(".sma.v1.Text.mentions: array expected");
                    m.mentions = $Array(d.mentions.length);
                    for (var i = 0; i < d.mentions.length; ++i) {
                        if (!$util.isObject(d.mentions[i]))
                            throw $TypeError(".sma.v1.Text.mentions: object expected");
                        m.mentions[i] = $root.sma.v1.Mention.fromObject(d.mentions[i], q + 1);
                    }
                }
                return m;
            };

            Text.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.arrays || o.defaults) {
                    d.mentions = [];
                }
                if (o.defaults) {
                    d.body = "";
                }
                if (m.body != null && $Object.hasOwnProperty.call(m, "body")) {
                    d.body = m.body;
                }
                if (m.mentions && m.mentions.length) {
                    d.mentions = $Array(m.mentions.length);
                    for (var j = 0; j < m.mentions.length; ++j) {
                        d.mentions[j] = $root.sma.v1.Mention.toObject(m.mentions[j], o, q + 1);
                    }
                }
                return d;
            };

            Text.prototype.toJSON = function() {
                return Text.toObject(this, $protobuf.util.toJSONOptions);
            };

            Text.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.Text";
            };

            return Text;
        })();

        v1.Mention = (function() {

            const Mention = function (p) {
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            Mention.prototype.start = 0;
            Mention.prototype.length = 0;
            Mention.prototype.fingerprint = $util.newBuffer([]);

            Mention.create = function(properties) {
                return new Mention(properties);
            };

            Mention.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.start != null && $Object.hasOwnProperty.call(m, "start") && m.start !== 0)
                    w.uint32(8).uint32(m.start);
                if (m.length != null && $Object.hasOwnProperty.call(m, "length") && m.length !== 0)
                    w.uint32(16).uint32(m.length);
                if (m.fingerprint != null && $Object.hasOwnProperty.call(m, "fingerprint") && m.fingerprint.length)
                    w.uint32(26).bytes(m.fingerprint);
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            Mention.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.Mention();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 0)
                                break;
                            if (v = r.uint32())
                                m.start = v;
                            else
                                delete m.start;
                            continue;
                        }
                    case 2: {
                            if (u !== 0)
                                break;
                            if (v = r.uint32())
                                m.length = v;
                            else
                                delete m.length;
                            continue;
                        }
                    case 3: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.fingerprint = v;
                            else
                                delete m.fingerprint;
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            Mention.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.start != null && $Object.hasOwnProperty.call(m, "start")) {
                    if (!$util.isInteger(m.start))
                        return "start: integer expected";
                }
                if (m.length != null && $Object.hasOwnProperty.call(m, "length")) {
                    if (!$util.isInteger(m.length))
                        return "length: integer expected";
                }
                if (m.fingerprint != null && $Object.hasOwnProperty.call(m, "fingerprint")) {
                    if (!(m.fingerprint && typeof m.fingerprint.length === "number" || $util.isString(m.fingerprint)))
                        return "fingerprint: buffer expected";
                }
                return null;
            };

            Mention.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.Mention)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.Mention: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.Mention();
                if (d.start != null) {
                    if ($Number(d.start) !== 0) {
                        m.start = d.start >>> 0;
                    }
                }
                if (d.length != null) {
                    if ($Number(d.length) !== 0) {
                        m.length = d.length >>> 0;
                    }
                }
                if (d.fingerprint != null) {
                    if (d.fingerprint.length) {
                        if (typeof d.fingerprint === "string")
                            $util.base64.decode(d.fingerprint, m.fingerprint = $util.newBuffer($util.base64.length(d.fingerprint)), 0);
                        else if (d.fingerprint.length >= 0)
                            m.fingerprint = d.fingerprint;
                    }
                }
                return m;
            };

            Mention.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.defaults) {
                    d.start = 0;
                    d.length = 0;
                    if (o.bytes === $String)
                        d.fingerprint = "";
                    else {
                        d.fingerprint = [];
                        if (o.bytes !== $Array)
                            d.fingerprint = $util.newBuffer(d.fingerprint);
                    }
                }
                if (m.start != null && $Object.hasOwnProperty.call(m, "start")) {
                    d.start = m.start;
                }
                if (m.length != null && $Object.hasOwnProperty.call(m, "length")) {
                    d.length = m.length;
                }
                if (m.fingerprint != null && $Object.hasOwnProperty.call(m, "fingerprint")) {
                    d.fingerprint = o.bytes === $String ? $util.base64.encode(m.fingerprint, 0, m.fingerprint.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.fingerprint) : m.fingerprint;
                }
                return d;
            };

            Mention.prototype.toJSON = function() {
                return Mention.toObject(this, $protobuf.util.toJSONOptions);
            };

            Mention.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.Mention";
            };

            return Mention;
        })();

        v1.FileManifest = (function() {

            const FileManifest = function (p) {
                this.chunks = [];
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            FileManifest.prototype.mimeType = "";
            FileManifest.prototype.fileName = "";
            FileManifest.prototype.size = $util.Long ? $util.Long.fromBits(0,0,true) : 0;
            FileManifest.prototype.fileKey = $util.newBuffer([]);
            FileManifest.prototype.noncePrefix = $util.newBuffer([]);
            FileManifest.prototype.chunkSize = 0;
            FileManifest.prototype.chunks = $util.emptyArray;
            FileManifest.prototype.plaintextSha256 = $util.newBuffer([]);
            FileManifest.prototype.thumbnail = $util.newBuffer([]);
            FileManifest.prototype.width = 0;
            FileManifest.prototype.height = 0;
            FileManifest.prototype.durationMs = 0;

            FileManifest.create = function(properties) {
                return new FileManifest(properties);
            };

            FileManifest.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.mimeType != null && $Object.hasOwnProperty.call(m, "mimeType") && m.mimeType !== "")
                    w.uint32(10).string(m.mimeType);
                if (m.fileName != null && $Object.hasOwnProperty.call(m, "fileName") && m.fileName !== "")
                    w.uint32(18).string(m.fileName);
                if (m.size != null && $Object.hasOwnProperty.call(m, "size") && (typeof m.size === "object" ? m.size.low || m.size.high : m.size !== 0))
                    w.uint32(24).uint64(m.size);
                if (m.fileKey != null && $Object.hasOwnProperty.call(m, "fileKey") && m.fileKey.length)
                    w.uint32(34).bytes(m.fileKey);
                if (m.noncePrefix != null && $Object.hasOwnProperty.call(m, "noncePrefix") && m.noncePrefix.length)
                    w.uint32(42).bytes(m.noncePrefix);
                if (m.chunkSize != null && $Object.hasOwnProperty.call(m, "chunkSize") && m.chunkSize !== 0)
                    w.uint32(48).uint32(m.chunkSize);
                if (m.chunks != null && m.chunks.length) {
                    for (var i = 0; i < m.chunks.length; ++i)
                        $root.sma.v1.BlobRef.encode(m.chunks[i], w.uint32(58).fork(), q + 1).ldelim();
                }
                if (m.plaintextSha256 != null && $Object.hasOwnProperty.call(m, "plaintextSha256") && m.plaintextSha256.length)
                    w.uint32(66).bytes(m.plaintextSha256);
                if (m.thumbnail != null && $Object.hasOwnProperty.call(m, "thumbnail") && m.thumbnail.length)
                    w.uint32(74).bytes(m.thumbnail);
                if (m.width != null && $Object.hasOwnProperty.call(m, "width") && m.width !== 0)
                    w.uint32(80).uint32(m.width);
                if (m.height != null && $Object.hasOwnProperty.call(m, "height") && m.height !== 0)
                    w.uint32(88).uint32(m.height);
                if (m.durationMs != null && $Object.hasOwnProperty.call(m, "durationMs") && m.durationMs !== 0)
                    w.uint32(96).uint32(m.durationMs);
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            FileManifest.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.FileManifest();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            if ((v = r.stringVerify()).length)
                                m.mimeType = v;
                            else
                                delete m.mimeType;
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            if ((v = r.stringVerify()).length)
                                m.fileName = v;
                            else
                                delete m.fileName;
                            continue;
                        }
                    case 3: {
                            if (u !== 0)
                                break;
                            if (typeof (v = r.uint64()) === "object" ? v.low || v.high : v !== 0)
                                m.size = v;
                            else
                                delete m.size;
                            continue;
                        }
                    case 4: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.fileKey = v;
                            else
                                delete m.fileKey;
                            continue;
                        }
                    case 5: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.noncePrefix = v;
                            else
                                delete m.noncePrefix;
                            continue;
                        }
                    case 6: {
                            if (u !== 0)
                                break;
                            if (v = r.uint32())
                                m.chunkSize = v;
                            else
                                delete m.chunkSize;
                            continue;
                        }
                    case 7: {
                            if (u !== 2)
                                break;
                            if (!(m.chunks && m.chunks.length))
                                m.chunks = [];
                            m.chunks.push($root.sma.v1.BlobRef.decode(r, r.size(), $undefined, q + 1));
                            continue;
                        }
                    case 8: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.plaintextSha256 = v;
                            else
                                delete m.plaintextSha256;
                            continue;
                        }
                    case 9: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.thumbnail = v;
                            else
                                delete m.thumbnail;
                            continue;
                        }
                    case 10: {
                            if (u !== 0)
                                break;
                            if (v = r.uint32())
                                m.width = v;
                            else
                                delete m.width;
                            continue;
                        }
                    case 11: {
                            if (u !== 0)
                                break;
                            if (v = r.uint32())
                                m.height = v;
                            else
                                delete m.height;
                            continue;
                        }
                    case 12: {
                            if (u !== 0)
                                break;
                            if (v = r.uint32())
                                m.durationMs = v;
                            else
                                delete m.durationMs;
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            FileManifest.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.mimeType != null && $Object.hasOwnProperty.call(m, "mimeType")) {
                    if (!$util.isString(m.mimeType))
                        return "mimeType: string expected";
                }
                if (m.fileName != null && $Object.hasOwnProperty.call(m, "fileName")) {
                    if (!$util.isString(m.fileName))
                        return "fileName: string expected";
                }
                if (m.size != null && $Object.hasOwnProperty.call(m, "size")) {
                    if (!$util.isInteger(m.size) && !(m.size && $util.isInteger(m.size.low) && $util.isInteger(m.size.high)))
                        return "size: integer|Long expected";
                }
                if (m.fileKey != null && $Object.hasOwnProperty.call(m, "fileKey")) {
                    if (!(m.fileKey && typeof m.fileKey.length === "number" || $util.isString(m.fileKey)))
                        return "fileKey: buffer expected";
                }
                if (m.noncePrefix != null && $Object.hasOwnProperty.call(m, "noncePrefix")) {
                    if (!(m.noncePrefix && typeof m.noncePrefix.length === "number" || $util.isString(m.noncePrefix)))
                        return "noncePrefix: buffer expected";
                }
                if (m.chunkSize != null && $Object.hasOwnProperty.call(m, "chunkSize")) {
                    if (!$util.isInteger(m.chunkSize))
                        return "chunkSize: integer expected";
                }
                if (m.chunks != null && $Object.hasOwnProperty.call(m, "chunks")) {
                    if (!$Array.isArray(m.chunks))
                        return "chunks: array expected";
                    for (var i = 0; i < m.chunks.length; ++i) {
                        {
                            var e = $root.sma.v1.BlobRef.verify(m.chunks[i], q + 1);
                            if (e)
                                return "chunks." + e;
                        }
                    }
                }
                if (m.plaintextSha256 != null && $Object.hasOwnProperty.call(m, "plaintextSha256")) {
                    if (!(m.plaintextSha256 && typeof m.plaintextSha256.length === "number" || $util.isString(m.plaintextSha256)))
                        return "plaintextSha256: buffer expected";
                }
                if (m.thumbnail != null && $Object.hasOwnProperty.call(m, "thumbnail")) {
                    if (!(m.thumbnail && typeof m.thumbnail.length === "number" || $util.isString(m.thumbnail)))
                        return "thumbnail: buffer expected";
                }
                if (m.width != null && $Object.hasOwnProperty.call(m, "width")) {
                    if (!$util.isInteger(m.width))
                        return "width: integer expected";
                }
                if (m.height != null && $Object.hasOwnProperty.call(m, "height")) {
                    if (!$util.isInteger(m.height))
                        return "height: integer expected";
                }
                if (m.durationMs != null && $Object.hasOwnProperty.call(m, "durationMs")) {
                    if (!$util.isInteger(m.durationMs))
                        return "durationMs: integer expected";
                }
                return null;
            };

            FileManifest.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.FileManifest)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.FileManifest: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.FileManifest();
                if (d.mimeType != null) {
                    if (typeof d.mimeType !== "string" || d.mimeType.length) {
                        m.mimeType = $String(d.mimeType);
                    }
                }
                if (d.fileName != null) {
                    if (typeof d.fileName !== "string" || d.fileName.length) {
                        m.fileName = $String(d.fileName);
                    }
                }
                if (d.size != null) {
                    if (typeof d.size === "object" ? d.size.low || d.size.high : $Number(d.size) !== 0) {
                        if ($util.Long)
                            m.size = $util.Long.fromValue(d.size, true);
                        else if (typeof d.size === "string")
                            m.size = $parseInt(d.size, 10);
                        else if (typeof d.size === "number")
                            m.size = d.size;
                        else if (typeof d.size === "object")
                            m.size = new $util.LongBits(d.size.low >>> 0, d.size.high >>> 0).toNumber(true);
                    }
                }
                if (d.fileKey != null) {
                    if (d.fileKey.length) {
                        if (typeof d.fileKey === "string")
                            $util.base64.decode(d.fileKey, m.fileKey = $util.newBuffer($util.base64.length(d.fileKey)), 0);
                        else if (d.fileKey.length >= 0)
                            m.fileKey = d.fileKey;
                    }
                }
                if (d.noncePrefix != null) {
                    if (d.noncePrefix.length) {
                        if (typeof d.noncePrefix === "string")
                            $util.base64.decode(d.noncePrefix, m.noncePrefix = $util.newBuffer($util.base64.length(d.noncePrefix)), 0);
                        else if (d.noncePrefix.length >= 0)
                            m.noncePrefix = d.noncePrefix;
                    }
                }
                if (d.chunkSize != null) {
                    if ($Number(d.chunkSize) !== 0) {
                        m.chunkSize = d.chunkSize >>> 0;
                    }
                }
                if (d.chunks) {
                    if (!$Array.isArray(d.chunks))
                        throw $TypeError(".sma.v1.FileManifest.chunks: array expected");
                    m.chunks = $Array(d.chunks.length);
                    for (var i = 0; i < d.chunks.length; ++i) {
                        if (!$util.isObject(d.chunks[i]))
                            throw $TypeError(".sma.v1.FileManifest.chunks: object expected");
                        m.chunks[i] = $root.sma.v1.BlobRef.fromObject(d.chunks[i], q + 1);
                    }
                }
                if (d.plaintextSha256 != null) {
                    if (d.plaintextSha256.length) {
                        if (typeof d.plaintextSha256 === "string")
                            $util.base64.decode(d.plaintextSha256, m.plaintextSha256 = $util.newBuffer($util.base64.length(d.plaintextSha256)), 0);
                        else if (d.plaintextSha256.length >= 0)
                            m.plaintextSha256 = d.plaintextSha256;
                    }
                }
                if (d.thumbnail != null) {
                    if (d.thumbnail.length) {
                        if (typeof d.thumbnail === "string")
                            $util.base64.decode(d.thumbnail, m.thumbnail = $util.newBuffer($util.base64.length(d.thumbnail)), 0);
                        else if (d.thumbnail.length >= 0)
                            m.thumbnail = d.thumbnail;
                    }
                }
                if (d.width != null) {
                    if ($Number(d.width) !== 0) {
                        m.width = d.width >>> 0;
                    }
                }
                if (d.height != null) {
                    if ($Number(d.height) !== 0) {
                        m.height = d.height >>> 0;
                    }
                }
                if (d.durationMs != null) {
                    if ($Number(d.durationMs) !== 0) {
                        m.durationMs = d.durationMs >>> 0;
                    }
                }
                return m;
            };

            FileManifest.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.arrays || o.defaults) {
                    d.chunks = [];
                }
                if (o.defaults) {
                    d.mimeType = "";
                    d.fileName = "";
                    if ($util.Long) {
                        var n = new $util.Long(0, 0, true);
                        d.size = o.longs === $String ? n.toString() : o.longs === $Number ? n.toNumber() : typeof $BigInt !== "undefined" && o.longs === $BigInt ? n.toBigInt() : n;
                    } else
                        d.size = o.longs === $String ? "0" : typeof $BigInt !== "undefined" && o.longs === $BigInt ? $BigInt("0") : 0;
                    if (o.bytes === $String)
                        d.fileKey = "";
                    else {
                        d.fileKey = [];
                        if (o.bytes !== $Array)
                            d.fileKey = $util.newBuffer(d.fileKey);
                    }
                    if (o.bytes === $String)
                        d.noncePrefix = "";
                    else {
                        d.noncePrefix = [];
                        if (o.bytes !== $Array)
                            d.noncePrefix = $util.newBuffer(d.noncePrefix);
                    }
                    d.chunkSize = 0;
                    if (o.bytes === $String)
                        d.plaintextSha256 = "";
                    else {
                        d.plaintextSha256 = [];
                        if (o.bytes !== $Array)
                            d.plaintextSha256 = $util.newBuffer(d.plaintextSha256);
                    }
                    if (o.bytes === $String)
                        d.thumbnail = "";
                    else {
                        d.thumbnail = [];
                        if (o.bytes !== $Array)
                            d.thumbnail = $util.newBuffer(d.thumbnail);
                    }
                    d.width = 0;
                    d.height = 0;
                    d.durationMs = 0;
                }
                if (m.mimeType != null && $Object.hasOwnProperty.call(m, "mimeType")) {
                    d.mimeType = m.mimeType;
                }
                if (m.fileName != null && $Object.hasOwnProperty.call(m, "fileName")) {
                    d.fileName = m.fileName;
                }
                if (m.size != null && $Object.hasOwnProperty.call(m, "size")) {
                    if (typeof $BigInt !== "undefined" && o.longs === $BigInt)
                        d.size = typeof m.size === "number" ? $BigInt(m.size) : $util.Long.fromBits(m.size.low >>> 0, m.size.high >>> 0, true).toBigInt();
                    else if (typeof m.size === "number")
                        d.size = o.longs === $String ? $String(m.size) : m.size;
                    else
                        d.size = o.longs === $String ? $util.Long.prototype.toString.call(m.size) : o.longs === $Number ? new $util.LongBits(m.size.low >>> 0, m.size.high >>> 0).toNumber(true) : m.size;
                }
                if (m.fileKey != null && $Object.hasOwnProperty.call(m, "fileKey")) {
                    d.fileKey = o.bytes === $String ? $util.base64.encode(m.fileKey, 0, m.fileKey.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.fileKey) : m.fileKey;
                }
                if (m.noncePrefix != null && $Object.hasOwnProperty.call(m, "noncePrefix")) {
                    d.noncePrefix = o.bytes === $String ? $util.base64.encode(m.noncePrefix, 0, m.noncePrefix.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.noncePrefix) : m.noncePrefix;
                }
                if (m.chunkSize != null && $Object.hasOwnProperty.call(m, "chunkSize")) {
                    d.chunkSize = m.chunkSize;
                }
                if (m.chunks && m.chunks.length) {
                    d.chunks = $Array(m.chunks.length);
                    for (var j = 0; j < m.chunks.length; ++j) {
                        d.chunks[j] = $root.sma.v1.BlobRef.toObject(m.chunks[j], o, q + 1);
                    }
                }
                if (m.plaintextSha256 != null && $Object.hasOwnProperty.call(m, "plaintextSha256")) {
                    d.plaintextSha256 = o.bytes === $String ? $util.base64.encode(m.plaintextSha256, 0, m.plaintextSha256.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.plaintextSha256) : m.plaintextSha256;
                }
                if (m.thumbnail != null && $Object.hasOwnProperty.call(m, "thumbnail")) {
                    d.thumbnail = o.bytes === $String ? $util.base64.encode(m.thumbnail, 0, m.thumbnail.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.thumbnail) : m.thumbnail;
                }
                if (m.width != null && $Object.hasOwnProperty.call(m, "width")) {
                    d.width = m.width;
                }
                if (m.height != null && $Object.hasOwnProperty.call(m, "height")) {
                    d.height = m.height;
                }
                if (m.durationMs != null && $Object.hasOwnProperty.call(m, "durationMs")) {
                    d.durationMs = m.durationMs;
                }
                return d;
            };

            FileManifest.prototype.toJSON = function() {
                return FileManifest.toObject(this, $protobuf.util.toJSONOptions);
            };

            FileManifest.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.FileManifest";
            };

            return FileManifest;
        })();

        v1.BlobRef = (function() {

            const BlobRef = function (p) {
                this.locators = [];
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            BlobRef.prototype.ciphertextSha256 = $util.newBuffer([]);
            BlobRef.prototype.locators = $util.emptyArray;

            BlobRef.create = function(properties) {
                return new BlobRef(properties);
            };

            BlobRef.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.ciphertextSha256 != null && $Object.hasOwnProperty.call(m, "ciphertextSha256") && m.ciphertextSha256.length)
                    w.uint32(10).bytes(m.ciphertextSha256);
                if (m.locators != null && m.locators.length) {
                    for (var i = 0; i < m.locators.length; ++i)
                        $root.sma.v1.Locator.encode(m.locators[i], w.uint32(18).fork(), q + 1).ldelim();
                }
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            BlobRef.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.BlobRef();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.ciphertextSha256 = v;
                            else
                                delete m.ciphertextSha256;
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            if (!(m.locators && m.locators.length))
                                m.locators = [];
                            m.locators.push($root.sma.v1.Locator.decode(r, r.size(), $undefined, q + 1));
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            BlobRef.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.ciphertextSha256 != null && $Object.hasOwnProperty.call(m, "ciphertextSha256")) {
                    if (!(m.ciphertextSha256 && typeof m.ciphertextSha256.length === "number" || $util.isString(m.ciphertextSha256)))
                        return "ciphertextSha256: buffer expected";
                }
                if (m.locators != null && $Object.hasOwnProperty.call(m, "locators")) {
                    if (!$Array.isArray(m.locators))
                        return "locators: array expected";
                    for (var i = 0; i < m.locators.length; ++i) {
                        {
                            var e = $root.sma.v1.Locator.verify(m.locators[i], q + 1);
                            if (e)
                                return "locators." + e;
                        }
                    }
                }
                return null;
            };

            BlobRef.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.BlobRef)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.BlobRef: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.BlobRef();
                if (d.ciphertextSha256 != null) {
                    if (d.ciphertextSha256.length) {
                        if (typeof d.ciphertextSha256 === "string")
                            $util.base64.decode(d.ciphertextSha256, m.ciphertextSha256 = $util.newBuffer($util.base64.length(d.ciphertextSha256)), 0);
                        else if (d.ciphertextSha256.length >= 0)
                            m.ciphertextSha256 = d.ciphertextSha256;
                    }
                }
                if (d.locators) {
                    if (!$Array.isArray(d.locators))
                        throw $TypeError(".sma.v1.BlobRef.locators: array expected");
                    m.locators = $Array(d.locators.length);
                    for (var i = 0; i < d.locators.length; ++i) {
                        if (!$util.isObject(d.locators[i]))
                            throw $TypeError(".sma.v1.BlobRef.locators: object expected");
                        m.locators[i] = $root.sma.v1.Locator.fromObject(d.locators[i], q + 1);
                    }
                }
                return m;
            };

            BlobRef.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.arrays || o.defaults) {
                    d.locators = [];
                }
                if (o.defaults) {
                    if (o.bytes === $String)
                        d.ciphertextSha256 = "";
                    else {
                        d.ciphertextSha256 = [];
                        if (o.bytes !== $Array)
                            d.ciphertextSha256 = $util.newBuffer(d.ciphertextSha256);
                    }
                }
                if (m.ciphertextSha256 != null && $Object.hasOwnProperty.call(m, "ciphertextSha256")) {
                    d.ciphertextSha256 = o.bytes === $String ? $util.base64.encode(m.ciphertextSha256, 0, m.ciphertextSha256.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.ciphertextSha256) : m.ciphertextSha256;
                }
                if (m.locators && m.locators.length) {
                    d.locators = $Array(m.locators.length);
                    for (var j = 0; j < m.locators.length; ++j) {
                        d.locators[j] = $root.sma.v1.Locator.toObject(m.locators[j], o, q + 1);
                    }
                }
                return d;
            };

            BlobRef.prototype.toJSON = function() {
                return BlobRef.toObject(this, $protobuf.util.toJSONOptions);
            };

            BlobRef.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.BlobRef";
            };

            return BlobRef;
        })();

        v1.CallSignal = (function() {

            const CallSignal = function (p) {
                this.candidates = [];
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            CallSignal.prototype.callId = $util.newBuffer([]);
            CallSignal.prototype.type = 0;
            CallSignal.prototype.sdp = "";
            CallSignal.prototype.candidates = $util.emptyArray;
            CallSignal.prototype.mediaKeySeed = $util.newBuffer([]);
            CallSignal.prototype.keyEpoch = 0;
            CallSignal.prototype.video = false;
            CallSignal.prototype.expiresAtMs = $util.Long ? $util.Long.fromBits(0,0,true) : 0;
            CallSignal.prototype.reason = "";

            CallSignal.create = function(properties) {
                return new CallSignal(properties);
            };

            CallSignal.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.callId != null && $Object.hasOwnProperty.call(m, "callId") && m.callId.length)
                    w.uint32(10).bytes(m.callId);
                if (m.type != null && $Object.hasOwnProperty.call(m, "type") && m.type !== 0)
                    w.uint32(16).int32(m.type);
                if (m.sdp != null && $Object.hasOwnProperty.call(m, "sdp") && m.sdp !== "")
                    w.uint32(26).string(m.sdp);
                if (m.candidates != null && m.candidates.length) {
                    for (var i = 0; i < m.candidates.length; ++i)
                        $root.sma.v1.IceCandidate.encode(m.candidates[i], w.uint32(34).fork(), q + 1).ldelim();
                }
                if (m.mediaKeySeed != null && $Object.hasOwnProperty.call(m, "mediaKeySeed") && m.mediaKeySeed.length)
                    w.uint32(42).bytes(m.mediaKeySeed);
                if (m.keyEpoch != null && $Object.hasOwnProperty.call(m, "keyEpoch") && m.keyEpoch !== 0)
                    w.uint32(48).uint32(m.keyEpoch);
                if (m.video != null && $Object.hasOwnProperty.call(m, "video") && m.video !== false)
                    w.uint32(56).bool(m.video);
                if (m.expiresAtMs != null && $Object.hasOwnProperty.call(m, "expiresAtMs") && (typeof m.expiresAtMs === "object" ? m.expiresAtMs.low || m.expiresAtMs.high : m.expiresAtMs !== 0))
                    w.uint32(64).uint64(m.expiresAtMs);
                if (m.reason != null && $Object.hasOwnProperty.call(m, "reason") && m.reason !== "")
                    w.uint32(74).string(m.reason);
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            CallSignal.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.CallSignal();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.callId = v;
                            else
                                delete m.callId;
                            continue;
                        }
                    case 2: {
                            if (u !== 0)
                                break;
                            if (v = r.int32())
                                m.type = v;
                            else
                                delete m.type;
                            continue;
                        }
                    case 3: {
                            if (u !== 2)
                                break;
                            if ((v = r.stringVerify()).length)
                                m.sdp = v;
                            else
                                delete m.sdp;
                            continue;
                        }
                    case 4: {
                            if (u !== 2)
                                break;
                            if (!(m.candidates && m.candidates.length))
                                m.candidates = [];
                            m.candidates.push($root.sma.v1.IceCandidate.decode(r, r.size(), $undefined, q + 1));
                            continue;
                        }
                    case 5: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.mediaKeySeed = v;
                            else
                                delete m.mediaKeySeed;
                            continue;
                        }
                    case 6: {
                            if (u !== 0)
                                break;
                            if (v = r.uint32())
                                m.keyEpoch = v;
                            else
                                delete m.keyEpoch;
                            continue;
                        }
                    case 7: {
                            if (u !== 0)
                                break;
                            if (v = r.bool())
                                m.video = v;
                            else
                                delete m.video;
                            continue;
                        }
                    case 8: {
                            if (u !== 0)
                                break;
                            if (typeof (v = r.uint64()) === "object" ? v.low || v.high : v !== 0)
                                m.expiresAtMs = v;
                            else
                                delete m.expiresAtMs;
                            continue;
                        }
                    case 9: {
                            if (u !== 2)
                                break;
                            if ((v = r.stringVerify()).length)
                                m.reason = v;
                            else
                                delete m.reason;
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            CallSignal.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.callId != null && $Object.hasOwnProperty.call(m, "callId")) {
                    if (!(m.callId && typeof m.callId.length === "number" || $util.isString(m.callId)))
                        return "callId: buffer expected";
                }
                if (m.type != null && $Object.hasOwnProperty.call(m, "type")) {
                    if (typeof m.type !== "number" || (m.type | 0) !== m.type)
                        return "type: enum value expected";
                }
                if (m.sdp != null && $Object.hasOwnProperty.call(m, "sdp")) {
                    if (!$util.isString(m.sdp))
                        return "sdp: string expected";
                }
                if (m.candidates != null && $Object.hasOwnProperty.call(m, "candidates")) {
                    if (!$Array.isArray(m.candidates))
                        return "candidates: array expected";
                    for (var i = 0; i < m.candidates.length; ++i) {
                        {
                            var e = $root.sma.v1.IceCandidate.verify(m.candidates[i], q + 1);
                            if (e)
                                return "candidates." + e;
                        }
                    }
                }
                if (m.mediaKeySeed != null && $Object.hasOwnProperty.call(m, "mediaKeySeed")) {
                    if (!(m.mediaKeySeed && typeof m.mediaKeySeed.length === "number" || $util.isString(m.mediaKeySeed)))
                        return "mediaKeySeed: buffer expected";
                }
                if (m.keyEpoch != null && $Object.hasOwnProperty.call(m, "keyEpoch")) {
                    if (!$util.isInteger(m.keyEpoch))
                        return "keyEpoch: integer expected";
                }
                if (m.video != null && $Object.hasOwnProperty.call(m, "video")) {
                    if (typeof m.video !== "boolean")
                        return "video: boolean expected";
                }
                if (m.expiresAtMs != null && $Object.hasOwnProperty.call(m, "expiresAtMs")) {
                    if (!$util.isInteger(m.expiresAtMs) && !(m.expiresAtMs && $util.isInteger(m.expiresAtMs.low) && $util.isInteger(m.expiresAtMs.high)))
                        return "expiresAtMs: integer|Long expected";
                }
                if (m.reason != null && $Object.hasOwnProperty.call(m, "reason")) {
                    if (!$util.isString(m.reason))
                        return "reason: string expected";
                }
                return null;
            };

            CallSignal.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.CallSignal)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.CallSignal: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.CallSignal();
                if (d.callId != null) {
                    if (d.callId.length) {
                        if (typeof d.callId === "string")
                            $util.base64.decode(d.callId, m.callId = $util.newBuffer($util.base64.length(d.callId)), 0);
                        else if (d.callId.length >= 0)
                            m.callId = d.callId;
                    }
                }
                if (d.type !== 0 && (typeof d.type !== "string" || $root.sma.v1.CallSignal.Type[d.type] !== 0)) {
                    switch (d.type) {
                    case "TYPE_UNSPECIFIED":
                    case 0:
                        m.type = 0;
                        break;
                    case "OFFER":
                    case 1:
                        m.type = 1;
                        break;
                    case "ANSWER":
                    case 2:
                        m.type = 2;
                        break;
                    case "ICE_CANDIDATES":
                    case 3:
                        m.type = 3;
                        break;
                    case "RINGING":
                    case 4:
                        m.type = 4;
                        break;
                    case "HANGUP":
                    case 5:
                        m.type = 5;
                        break;
                    case "REJECT":
                    case 6:
                        m.type = 6;
                        break;
                    case "BUSY":
                    case 7:
                        m.type = 7;
                        break;
                    case "RENEGOTIATE":
                    case 8:
                        m.type = 8;
                        break;
                    case "MEDIA_KEY_UPDATE":
                    case 9:
                        m.type = 9;
                        break;
                    default:
                        if (typeof d.type === "number" && (d.type | 0) === d.type)
                            m.type = d.type;
                    }
                }
                if (d.sdp != null) {
                    if (typeof d.sdp !== "string" || d.sdp.length) {
                        m.sdp = $String(d.sdp);
                    }
                }
                if (d.candidates) {
                    if (!$Array.isArray(d.candidates))
                        throw $TypeError(".sma.v1.CallSignal.candidates: array expected");
                    m.candidates = $Array(d.candidates.length);
                    for (var i = 0; i < d.candidates.length; ++i) {
                        if (!$util.isObject(d.candidates[i]))
                            throw $TypeError(".sma.v1.CallSignal.candidates: object expected");
                        m.candidates[i] = $root.sma.v1.IceCandidate.fromObject(d.candidates[i], q + 1);
                    }
                }
                if (d.mediaKeySeed != null) {
                    if (d.mediaKeySeed.length) {
                        if (typeof d.mediaKeySeed === "string")
                            $util.base64.decode(d.mediaKeySeed, m.mediaKeySeed = $util.newBuffer($util.base64.length(d.mediaKeySeed)), 0);
                        else if (d.mediaKeySeed.length >= 0)
                            m.mediaKeySeed = d.mediaKeySeed;
                    }
                }
                if (d.keyEpoch != null) {
                    if ($Number(d.keyEpoch) !== 0) {
                        m.keyEpoch = d.keyEpoch >>> 0;
                    }
                }
                if (d.video != null) {
                    if (d.video) {
                        m.video = $Boolean(d.video);
                    }
                }
                if (d.expiresAtMs != null) {
                    if (typeof d.expiresAtMs === "object" ? d.expiresAtMs.low || d.expiresAtMs.high : $Number(d.expiresAtMs) !== 0) {
                        if ($util.Long)
                            m.expiresAtMs = $util.Long.fromValue(d.expiresAtMs, true);
                        else if (typeof d.expiresAtMs === "string")
                            m.expiresAtMs = $parseInt(d.expiresAtMs, 10);
                        else if (typeof d.expiresAtMs === "number")
                            m.expiresAtMs = d.expiresAtMs;
                        else if (typeof d.expiresAtMs === "object")
                            m.expiresAtMs = new $util.LongBits(d.expiresAtMs.low >>> 0, d.expiresAtMs.high >>> 0).toNumber(true);
                    }
                }
                if (d.reason != null) {
                    if (typeof d.reason !== "string" || d.reason.length) {
                        m.reason = $String(d.reason);
                    }
                }
                return m;
            };

            CallSignal.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.arrays || o.defaults) {
                    d.candidates = [];
                }
                if (o.defaults) {
                    if (o.bytes === $String)
                        d.callId = "";
                    else {
                        d.callId = [];
                        if (o.bytes !== $Array)
                            d.callId = $util.newBuffer(d.callId);
                    }
                    d.type = o.enums === $String ? "TYPE_UNSPECIFIED" : 0;
                    d.sdp = "";
                    if (o.bytes === $String)
                        d.mediaKeySeed = "";
                    else {
                        d.mediaKeySeed = [];
                        if (o.bytes !== $Array)
                            d.mediaKeySeed = $util.newBuffer(d.mediaKeySeed);
                    }
                    d.keyEpoch = 0;
                    d.video = false;
                    if ($util.Long) {
                        var n = new $util.Long(0, 0, true);
                        d.expiresAtMs = o.longs === $String ? n.toString() : o.longs === $Number ? n.toNumber() : typeof $BigInt !== "undefined" && o.longs === $BigInt ? n.toBigInt() : n;
                    } else
                        d.expiresAtMs = o.longs === $String ? "0" : typeof $BigInt !== "undefined" && o.longs === $BigInt ? $BigInt("0") : 0;
                    d.reason = "";
                }
                if (m.callId != null && $Object.hasOwnProperty.call(m, "callId")) {
                    d.callId = o.bytes === $String ? $util.base64.encode(m.callId, 0, m.callId.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.callId) : m.callId;
                }
                if (m.type != null && $Object.hasOwnProperty.call(m, "type")) {
                    d.type = o.enums === $String ? $root.sma.v1.CallSignal.Type[m.type] === $undefined ? m.type : $root.sma.v1.CallSignal.Type[m.type] : m.type;
                }
                if (m.sdp != null && $Object.hasOwnProperty.call(m, "sdp")) {
                    d.sdp = m.sdp;
                }
                if (m.candidates && m.candidates.length) {
                    d.candidates = $Array(m.candidates.length);
                    for (var j = 0; j < m.candidates.length; ++j) {
                        d.candidates[j] = $root.sma.v1.IceCandidate.toObject(m.candidates[j], o, q + 1);
                    }
                }
                if (m.mediaKeySeed != null && $Object.hasOwnProperty.call(m, "mediaKeySeed")) {
                    d.mediaKeySeed = o.bytes === $String ? $util.base64.encode(m.mediaKeySeed, 0, m.mediaKeySeed.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.mediaKeySeed) : m.mediaKeySeed;
                }
                if (m.keyEpoch != null && $Object.hasOwnProperty.call(m, "keyEpoch")) {
                    d.keyEpoch = m.keyEpoch;
                }
                if (m.video != null && $Object.hasOwnProperty.call(m, "video")) {
                    d.video = m.video;
                }
                if (m.expiresAtMs != null && $Object.hasOwnProperty.call(m, "expiresAtMs")) {
                    if (typeof $BigInt !== "undefined" && o.longs === $BigInt)
                        d.expiresAtMs = typeof m.expiresAtMs === "number" ? $BigInt(m.expiresAtMs) : $util.Long.fromBits(m.expiresAtMs.low >>> 0, m.expiresAtMs.high >>> 0, true).toBigInt();
                    else if (typeof m.expiresAtMs === "number")
                        d.expiresAtMs = o.longs === $String ? $String(m.expiresAtMs) : m.expiresAtMs;
                    else
                        d.expiresAtMs = o.longs === $String ? $util.Long.prototype.toString.call(m.expiresAtMs) : o.longs === $Number ? new $util.LongBits(m.expiresAtMs.low >>> 0, m.expiresAtMs.high >>> 0).toNumber(true) : m.expiresAtMs;
                }
                if (m.reason != null && $Object.hasOwnProperty.call(m, "reason")) {
                    d.reason = m.reason;
                }
                return d;
            };

            CallSignal.prototype.toJSON = function() {
                return CallSignal.toObject(this, $protobuf.util.toJSONOptions);
            };

            CallSignal.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.CallSignal";
            };

            CallSignal.Type = (function() {
                const valuesById = $Object.create(null), values = $Object.create(valuesById);
                values[valuesById[0] = "TYPE_UNSPECIFIED"] = 0;
                values[valuesById[1] = "OFFER"] = 1;
                values[valuesById[2] = "ANSWER"] = 2;
                values[valuesById[3] = "ICE_CANDIDATES"] = 3;
                values[valuesById[4] = "RINGING"] = 4;
                values[valuesById[5] = "HANGUP"] = 5;
                values[valuesById[6] = "REJECT"] = 6;
                values[valuesById[7] = "BUSY"] = 7;
                values[valuesById[8] = "RENEGOTIATE"] = 8;
                values[valuesById[9] = "MEDIA_KEY_UPDATE"] = 9;
                return values;
            })();

            return CallSignal;
        })();

        v1.IceCandidate = (function() {

            const IceCandidate = function (p) {
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            IceCandidate.prototype.candidate = "";
            IceCandidate.prototype.sdpMid = "";
            IceCandidate.prototype.sdpMLineIndex = 0;
            IceCandidate.prototype.usernameFragment = "";

            IceCandidate.create = function(properties) {
                return new IceCandidate(properties);
            };

            IceCandidate.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.candidate != null && $Object.hasOwnProperty.call(m, "candidate") && m.candidate !== "")
                    w.uint32(10).string(m.candidate);
                if (m.sdpMid != null && $Object.hasOwnProperty.call(m, "sdpMid") && m.sdpMid !== "")
                    w.uint32(18).string(m.sdpMid);
                if (m.sdpMLineIndex != null && $Object.hasOwnProperty.call(m, "sdpMLineIndex") && m.sdpMLineIndex !== 0)
                    w.uint32(24).uint32(m.sdpMLineIndex);
                if (m.usernameFragment != null && $Object.hasOwnProperty.call(m, "usernameFragment") && m.usernameFragment !== "")
                    w.uint32(34).string(m.usernameFragment);
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            IceCandidate.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.IceCandidate();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            if ((v = r.stringVerify()).length)
                                m.candidate = v;
                            else
                                delete m.candidate;
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            if ((v = r.stringVerify()).length)
                                m.sdpMid = v;
                            else
                                delete m.sdpMid;
                            continue;
                        }
                    case 3: {
                            if (u !== 0)
                                break;
                            if (v = r.uint32())
                                m.sdpMLineIndex = v;
                            else
                                delete m.sdpMLineIndex;
                            continue;
                        }
                    case 4: {
                            if (u !== 2)
                                break;
                            if ((v = r.stringVerify()).length)
                                m.usernameFragment = v;
                            else
                                delete m.usernameFragment;
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            IceCandidate.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.candidate != null && $Object.hasOwnProperty.call(m, "candidate")) {
                    if (!$util.isString(m.candidate))
                        return "candidate: string expected";
                }
                if (m.sdpMid != null && $Object.hasOwnProperty.call(m, "sdpMid")) {
                    if (!$util.isString(m.sdpMid))
                        return "sdpMid: string expected";
                }
                if (m.sdpMLineIndex != null && $Object.hasOwnProperty.call(m, "sdpMLineIndex")) {
                    if (!$util.isInteger(m.sdpMLineIndex))
                        return "sdpMLineIndex: integer expected";
                }
                if (m.usernameFragment != null && $Object.hasOwnProperty.call(m, "usernameFragment")) {
                    if (!$util.isString(m.usernameFragment))
                        return "usernameFragment: string expected";
                }
                return null;
            };

            IceCandidate.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.IceCandidate)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.IceCandidate: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.IceCandidate();
                if (d.candidate != null) {
                    if (typeof d.candidate !== "string" || d.candidate.length) {
                        m.candidate = $String(d.candidate);
                    }
                }
                if (d.sdpMid != null) {
                    if (typeof d.sdpMid !== "string" || d.sdpMid.length) {
                        m.sdpMid = $String(d.sdpMid);
                    }
                }
                if (d.sdpMLineIndex != null) {
                    if ($Number(d.sdpMLineIndex) !== 0) {
                        m.sdpMLineIndex = d.sdpMLineIndex >>> 0;
                    }
                }
                if (d.usernameFragment != null) {
                    if (typeof d.usernameFragment !== "string" || d.usernameFragment.length) {
                        m.usernameFragment = $String(d.usernameFragment);
                    }
                }
                return m;
            };

            IceCandidate.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.defaults) {
                    d.candidate = "";
                    d.sdpMid = "";
                    d.sdpMLineIndex = 0;
                    d.usernameFragment = "";
                }
                if (m.candidate != null && $Object.hasOwnProperty.call(m, "candidate")) {
                    d.candidate = m.candidate;
                }
                if (m.sdpMid != null && $Object.hasOwnProperty.call(m, "sdpMid")) {
                    d.sdpMid = m.sdpMid;
                }
                if (m.sdpMLineIndex != null && $Object.hasOwnProperty.call(m, "sdpMLineIndex")) {
                    d.sdpMLineIndex = m.sdpMLineIndex;
                }
                if (m.usernameFragment != null && $Object.hasOwnProperty.call(m, "usernameFragment")) {
                    d.usernameFragment = m.usernameFragment;
                }
                return d;
            };

            IceCandidate.prototype.toJSON = function() {
                return IceCandidate.toObject(this, $protobuf.util.toJSONOptions);
            };

            IceCandidate.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.IceCandidate";
            };

            return IceCandidate;
        })();

        v1.GroupKeyDistribution = (function() {

            const GroupKeyDistribution = function (p) {
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            GroupKeyDistribution.prototype.groupId = $util.newBuffer([]);
            GroupKeyDistribution.prototype.epoch = 0;
            GroupKeyDistribution.prototype.keyId = 0;
            GroupKeyDistribution.prototype.iteration = 0;
            GroupKeyDistribution.prototype.chainKey = $util.newBuffer([]);
            GroupKeyDistribution.prototype.signingKey = $util.newBuffer([]);

            GroupKeyDistribution.create = function(properties) {
                return new GroupKeyDistribution(properties);
            };

            GroupKeyDistribution.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.groupId != null && $Object.hasOwnProperty.call(m, "groupId") && m.groupId.length)
                    w.uint32(10).bytes(m.groupId);
                if (m.epoch != null && $Object.hasOwnProperty.call(m, "epoch") && m.epoch !== 0)
                    w.uint32(16).uint32(m.epoch);
                if (m.keyId != null && $Object.hasOwnProperty.call(m, "keyId") && m.keyId !== 0)
                    w.uint32(24).uint32(m.keyId);
                if (m.iteration != null && $Object.hasOwnProperty.call(m, "iteration") && m.iteration !== 0)
                    w.uint32(32).uint32(m.iteration);
                if (m.chainKey != null && $Object.hasOwnProperty.call(m, "chainKey") && m.chainKey.length)
                    w.uint32(42).bytes(m.chainKey);
                if (m.signingKey != null && $Object.hasOwnProperty.call(m, "signingKey") && m.signingKey.length)
                    w.uint32(50).bytes(m.signingKey);
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            GroupKeyDistribution.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.GroupKeyDistribution();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.groupId = v;
                            else
                                delete m.groupId;
                            continue;
                        }
                    case 2: {
                            if (u !== 0)
                                break;
                            if (v = r.uint32())
                                m.epoch = v;
                            else
                                delete m.epoch;
                            continue;
                        }
                    case 3: {
                            if (u !== 0)
                                break;
                            if (v = r.uint32())
                                m.keyId = v;
                            else
                                delete m.keyId;
                            continue;
                        }
                    case 4: {
                            if (u !== 0)
                                break;
                            if (v = r.uint32())
                                m.iteration = v;
                            else
                                delete m.iteration;
                            continue;
                        }
                    case 5: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.chainKey = v;
                            else
                                delete m.chainKey;
                            continue;
                        }
                    case 6: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.signingKey = v;
                            else
                                delete m.signingKey;
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            GroupKeyDistribution.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.groupId != null && $Object.hasOwnProperty.call(m, "groupId")) {
                    if (!(m.groupId && typeof m.groupId.length === "number" || $util.isString(m.groupId)))
                        return "groupId: buffer expected";
                }
                if (m.epoch != null && $Object.hasOwnProperty.call(m, "epoch")) {
                    if (!$util.isInteger(m.epoch))
                        return "epoch: integer expected";
                }
                if (m.keyId != null && $Object.hasOwnProperty.call(m, "keyId")) {
                    if (!$util.isInteger(m.keyId))
                        return "keyId: integer expected";
                }
                if (m.iteration != null && $Object.hasOwnProperty.call(m, "iteration")) {
                    if (!$util.isInteger(m.iteration))
                        return "iteration: integer expected";
                }
                if (m.chainKey != null && $Object.hasOwnProperty.call(m, "chainKey")) {
                    if (!(m.chainKey && typeof m.chainKey.length === "number" || $util.isString(m.chainKey)))
                        return "chainKey: buffer expected";
                }
                if (m.signingKey != null && $Object.hasOwnProperty.call(m, "signingKey")) {
                    if (!(m.signingKey && typeof m.signingKey.length === "number" || $util.isString(m.signingKey)))
                        return "signingKey: buffer expected";
                }
                return null;
            };

            GroupKeyDistribution.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.GroupKeyDistribution)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.GroupKeyDistribution: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.GroupKeyDistribution();
                if (d.groupId != null) {
                    if (d.groupId.length) {
                        if (typeof d.groupId === "string")
                            $util.base64.decode(d.groupId, m.groupId = $util.newBuffer($util.base64.length(d.groupId)), 0);
                        else if (d.groupId.length >= 0)
                            m.groupId = d.groupId;
                    }
                }
                if (d.epoch != null) {
                    if ($Number(d.epoch) !== 0) {
                        m.epoch = d.epoch >>> 0;
                    }
                }
                if (d.keyId != null) {
                    if ($Number(d.keyId) !== 0) {
                        m.keyId = d.keyId >>> 0;
                    }
                }
                if (d.iteration != null) {
                    if ($Number(d.iteration) !== 0) {
                        m.iteration = d.iteration >>> 0;
                    }
                }
                if (d.chainKey != null) {
                    if (d.chainKey.length) {
                        if (typeof d.chainKey === "string")
                            $util.base64.decode(d.chainKey, m.chainKey = $util.newBuffer($util.base64.length(d.chainKey)), 0);
                        else if (d.chainKey.length >= 0)
                            m.chainKey = d.chainKey;
                    }
                }
                if (d.signingKey != null) {
                    if (d.signingKey.length) {
                        if (typeof d.signingKey === "string")
                            $util.base64.decode(d.signingKey, m.signingKey = $util.newBuffer($util.base64.length(d.signingKey)), 0);
                        else if (d.signingKey.length >= 0)
                            m.signingKey = d.signingKey;
                    }
                }
                return m;
            };

            GroupKeyDistribution.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.defaults) {
                    if (o.bytes === $String)
                        d.groupId = "";
                    else {
                        d.groupId = [];
                        if (o.bytes !== $Array)
                            d.groupId = $util.newBuffer(d.groupId);
                    }
                    d.epoch = 0;
                    d.keyId = 0;
                    d.iteration = 0;
                    if (o.bytes === $String)
                        d.chainKey = "";
                    else {
                        d.chainKey = [];
                        if (o.bytes !== $Array)
                            d.chainKey = $util.newBuffer(d.chainKey);
                    }
                    if (o.bytes === $String)
                        d.signingKey = "";
                    else {
                        d.signingKey = [];
                        if (o.bytes !== $Array)
                            d.signingKey = $util.newBuffer(d.signingKey);
                    }
                }
                if (m.groupId != null && $Object.hasOwnProperty.call(m, "groupId")) {
                    d.groupId = o.bytes === $String ? $util.base64.encode(m.groupId, 0, m.groupId.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.groupId) : m.groupId;
                }
                if (m.epoch != null && $Object.hasOwnProperty.call(m, "epoch")) {
                    d.epoch = m.epoch;
                }
                if (m.keyId != null && $Object.hasOwnProperty.call(m, "keyId")) {
                    d.keyId = m.keyId;
                }
                if (m.iteration != null && $Object.hasOwnProperty.call(m, "iteration")) {
                    d.iteration = m.iteration;
                }
                if (m.chainKey != null && $Object.hasOwnProperty.call(m, "chainKey")) {
                    d.chainKey = o.bytes === $String ? $util.base64.encode(m.chainKey, 0, m.chainKey.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.chainKey) : m.chainKey;
                }
                if (m.signingKey != null && $Object.hasOwnProperty.call(m, "signingKey")) {
                    d.signingKey = o.bytes === $String ? $util.base64.encode(m.signingKey, 0, m.signingKey.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.signingKey) : m.signingKey;
                }
                return d;
            };

            GroupKeyDistribution.prototype.toJSON = function() {
                return GroupKeyDistribution.toObject(this, $protobuf.util.toJSONOptions);
            };

            GroupKeyDistribution.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.GroupKeyDistribution";
            };

            return GroupKeyDistribution;
        })();

        v1.GroupControl = (function() {

            const GroupControl = function (p) {
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            GroupControl.prototype.groupId = $util.newBuffer([]);
            GroupControl.prototype.epoch = 0;
            GroupControl.prototype.parentHash = $util.newBuffer([]);
            GroupControl.prototype.create = null;
            GroupControl.prototype.add = null;
            GroupControl.prototype.remove = null;
            GroupControl.prototype.metadata = null;

            let $oneOfFields;

            $Object.defineProperty(GroupControl.prototype, "op", {
                get: $util.oneOfGetter($oneOfFields = ["create", "add", "remove", "metadata"]),
                set: $util.oneOfSetter($oneOfFields)
            });

            GroupControl.create = function(properties) {
                return new GroupControl(properties);
            };

            GroupControl.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.groupId != null && $Object.hasOwnProperty.call(m, "groupId") && m.groupId.length)
                    w.uint32(10).bytes(m.groupId);
                if (m.epoch != null && $Object.hasOwnProperty.call(m, "epoch") && m.epoch !== 0)
                    w.uint32(16).uint32(m.epoch);
                if (m.parentHash != null && $Object.hasOwnProperty.call(m, "parentHash") && m.parentHash.length)
                    w.uint32(26).bytes(m.parentHash);
                if (m.create != null && $Object.hasOwnProperty.call(m, "create"))
                    $root.sma.v1.GroupCreate.encode(m.create, w.uint32(82).fork(), q + 1).ldelim();
                if (m.add != null && $Object.hasOwnProperty.call(m, "add"))
                    $root.sma.v1.MemberChange.encode(m.add, w.uint32(90).fork(), q + 1).ldelim();
                if (m.remove != null && $Object.hasOwnProperty.call(m, "remove"))
                    $root.sma.v1.MemberChange.encode(m.remove, w.uint32(98).fork(), q + 1).ldelim();
                if (m.metadata != null && $Object.hasOwnProperty.call(m, "metadata"))
                    $root.sma.v1.GroupMetadata.encode(m.metadata, w.uint32(106).fork(), q + 1).ldelim();
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            GroupControl.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.GroupControl();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.groupId = v;
                            else
                                delete m.groupId;
                            continue;
                        }
                    case 2: {
                            if (u !== 0)
                                break;
                            if (v = r.uint32())
                                m.epoch = v;
                            else
                                delete m.epoch;
                            continue;
                        }
                    case 3: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.parentHash = v;
                            else
                                delete m.parentHash;
                            continue;
                        }
                    case 10: {
                            if (u !== 2)
                                break;
                            m.create = $root.sma.v1.GroupCreate.decode(r, r.size(), $undefined, q + 1, m.create);
                            m.op = "create";
                            continue;
                        }
                    case 11: {
                            if (u !== 2)
                                break;
                            m.add = $root.sma.v1.MemberChange.decode(r, r.size(), $undefined, q + 1, m.add);
                            m.op = "add";
                            continue;
                        }
                    case 12: {
                            if (u !== 2)
                                break;
                            m.remove = $root.sma.v1.MemberChange.decode(r, r.size(), $undefined, q + 1, m.remove);
                            m.op = "remove";
                            continue;
                        }
                    case 13: {
                            if (u !== 2)
                                break;
                            m.metadata = $root.sma.v1.GroupMetadata.decode(r, r.size(), $undefined, q + 1, m.metadata);
                            m.op = "metadata";
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            GroupControl.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                var p = {};
                if (m.groupId != null && $Object.hasOwnProperty.call(m, "groupId")) {
                    if (!(m.groupId && typeof m.groupId.length === "number" || $util.isString(m.groupId)))
                        return "groupId: buffer expected";
                }
                if (m.epoch != null && $Object.hasOwnProperty.call(m, "epoch")) {
                    if (!$util.isInteger(m.epoch))
                        return "epoch: integer expected";
                }
                if (m.parentHash != null && $Object.hasOwnProperty.call(m, "parentHash")) {
                    if (!(m.parentHash && typeof m.parentHash.length === "number" || $util.isString(m.parentHash)))
                        return "parentHash: buffer expected";
                }
                if (m.create != null && $Object.hasOwnProperty.call(m, "create")) {
                    p.op = 1;
                    {
                        var e = $root.sma.v1.GroupCreate.verify(m.create, q + 1);
                        if (e)
                            return "create." + e;
                    }
                }
                if (m.add != null && $Object.hasOwnProperty.call(m, "add")) {
                    if (p.op === 1)
                        return "op: multiple values";
                    p.op = 1;
                    {
                        var e = $root.sma.v1.MemberChange.verify(m.add, q + 1);
                        if (e)
                            return "add." + e;
                    }
                }
                if (m.remove != null && $Object.hasOwnProperty.call(m, "remove")) {
                    if (p.op === 1)
                        return "op: multiple values";
                    p.op = 1;
                    {
                        var e = $root.sma.v1.MemberChange.verify(m.remove, q + 1);
                        if (e)
                            return "remove." + e;
                    }
                }
                if (m.metadata != null && $Object.hasOwnProperty.call(m, "metadata")) {
                    if (p.op === 1)
                        return "op: multiple values";
                    p.op = 1;
                    {
                        var e = $root.sma.v1.GroupMetadata.verify(m.metadata, q + 1);
                        if (e)
                            return "metadata." + e;
                    }
                }
                return null;
            };

            GroupControl.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.GroupControl)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.GroupControl: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.GroupControl();
                if (d.groupId != null) {
                    if (d.groupId.length) {
                        if (typeof d.groupId === "string")
                            $util.base64.decode(d.groupId, m.groupId = $util.newBuffer($util.base64.length(d.groupId)), 0);
                        else if (d.groupId.length >= 0)
                            m.groupId = d.groupId;
                    }
                }
                if (d.epoch != null) {
                    if ($Number(d.epoch) !== 0) {
                        m.epoch = d.epoch >>> 0;
                    }
                }
                if (d.parentHash != null) {
                    if (d.parentHash.length) {
                        if (typeof d.parentHash === "string")
                            $util.base64.decode(d.parentHash, m.parentHash = $util.newBuffer($util.base64.length(d.parentHash)), 0);
                        else if (d.parentHash.length >= 0)
                            m.parentHash = d.parentHash;
                    }
                }
                if (d.create != null) {
                    if (!$util.isObject(d.create))
                        throw $TypeError(".sma.v1.GroupControl.create: object expected");
                    m.create = $root.sma.v1.GroupCreate.fromObject(d.create, q + 1);
                }
                if (d.add != null) {
                    if (!$util.isObject(d.add))
                        throw $TypeError(".sma.v1.GroupControl.add: object expected");
                    m.add = $root.sma.v1.MemberChange.fromObject(d.add, q + 1);
                }
                if (d.remove != null) {
                    if (!$util.isObject(d.remove))
                        throw $TypeError(".sma.v1.GroupControl.remove: object expected");
                    m.remove = $root.sma.v1.MemberChange.fromObject(d.remove, q + 1);
                }
                if (d.metadata != null) {
                    if (!$util.isObject(d.metadata))
                        throw $TypeError(".sma.v1.GroupControl.metadata: object expected");
                    m.metadata = $root.sma.v1.GroupMetadata.fromObject(d.metadata, q + 1);
                }
                return m;
            };

            GroupControl.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.defaults) {
                    if (o.bytes === $String)
                        d.groupId = "";
                    else {
                        d.groupId = [];
                        if (o.bytes !== $Array)
                            d.groupId = $util.newBuffer(d.groupId);
                    }
                    d.epoch = 0;
                    if (o.bytes === $String)
                        d.parentHash = "";
                    else {
                        d.parentHash = [];
                        if (o.bytes !== $Array)
                            d.parentHash = $util.newBuffer(d.parentHash);
                    }
                }
                if (m.groupId != null && $Object.hasOwnProperty.call(m, "groupId")) {
                    d.groupId = o.bytes === $String ? $util.base64.encode(m.groupId, 0, m.groupId.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.groupId) : m.groupId;
                }
                if (m.epoch != null && $Object.hasOwnProperty.call(m, "epoch")) {
                    d.epoch = m.epoch;
                }
                if (m.parentHash != null && $Object.hasOwnProperty.call(m, "parentHash")) {
                    d.parentHash = o.bytes === $String ? $util.base64.encode(m.parentHash, 0, m.parentHash.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.parentHash) : m.parentHash;
                }
                if (m.create != null && $Object.hasOwnProperty.call(m, "create")) {
                    d.create = $root.sma.v1.GroupCreate.toObject(m.create, o, q + 1);
                    if (o.oneofs)
                        d.op = "create";
                }
                if (m.add != null && $Object.hasOwnProperty.call(m, "add")) {
                    d.add = $root.sma.v1.MemberChange.toObject(m.add, o, q + 1);
                    if (o.oneofs)
                        d.op = "add";
                }
                if (m.remove != null && $Object.hasOwnProperty.call(m, "remove")) {
                    d.remove = $root.sma.v1.MemberChange.toObject(m.remove, o, q + 1);
                    if (o.oneofs)
                        d.op = "remove";
                }
                if (m.metadata != null && $Object.hasOwnProperty.call(m, "metadata")) {
                    d.metadata = $root.sma.v1.GroupMetadata.toObject(m.metadata, o, q + 1);
                    if (o.oneofs)
                        d.op = "metadata";
                }
                return d;
            };

            GroupControl.prototype.toJSON = function() {
                return GroupControl.toObject(this, $protobuf.util.toJSONOptions);
            };

            GroupControl.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.GroupControl";
            };

            return GroupControl;
        })();

        v1.GroupCreate = (function() {

            const GroupCreate = function (p) {
                this.members = [];
                this.admins = [];
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            GroupCreate.prototype.members = $util.emptyArray;
            GroupCreate.prototype.admins = $util.emptyArray;
            GroupCreate.prototype.metadata = null;

            GroupCreate.create = function(properties) {
                return new GroupCreate(properties);
            };

            GroupCreate.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.members != null && m.members.length) {
                    for (var i = 0; i < m.members.length; ++i)
                        w.uint32(10).bytes(m.members[i]);
                }
                if (m.admins != null && m.admins.length) {
                    for (var i = 0; i < m.admins.length; ++i)
                        w.uint32(18).bytes(m.admins[i]);
                }
                if (m.metadata != null && $Object.hasOwnProperty.call(m, "metadata"))
                    $root.sma.v1.GroupMetadata.encode(m.metadata, w.uint32(26).fork(), q + 1).ldelim();
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            GroupCreate.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.GroupCreate();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            if (!(m.members && m.members.length))
                                m.members = [];
                            m.members.push(r.bytes());
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            if (!(m.admins && m.admins.length))
                                m.admins = [];
                            m.admins.push(r.bytes());
                            continue;
                        }
                    case 3: {
                            if (u !== 2)
                                break;
                            m.metadata = $root.sma.v1.GroupMetadata.decode(r, r.size(), $undefined, q + 1, m.metadata);
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            GroupCreate.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.members != null && $Object.hasOwnProperty.call(m, "members")) {
                    if (!$Array.isArray(m.members))
                        return "members: array expected";
                    for (var i = 0; i < m.members.length; ++i) {
                        if (!(m.members[i] && typeof m.members[i].length === "number" || $util.isString(m.members[i])))
                            return "members: buffer[] expected";
                    }
                }
                if (m.admins != null && $Object.hasOwnProperty.call(m, "admins")) {
                    if (!$Array.isArray(m.admins))
                        return "admins: array expected";
                    for (var i = 0; i < m.admins.length; ++i) {
                        if (!(m.admins[i] && typeof m.admins[i].length === "number" || $util.isString(m.admins[i])))
                            return "admins: buffer[] expected";
                    }
                }
                if (m.metadata != null && $Object.hasOwnProperty.call(m, "metadata")) {
                    {
                        var e = $root.sma.v1.GroupMetadata.verify(m.metadata, q + 1);
                        if (e)
                            return "metadata." + e;
                    }
                }
                return null;
            };

            GroupCreate.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.GroupCreate)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.GroupCreate: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.GroupCreate();
                if (d.members) {
                    if (!$Array.isArray(d.members))
                        throw $TypeError(".sma.v1.GroupCreate.members: array expected");
                    m.members = $Array(d.members.length);
                    for (var i = 0; i < d.members.length; ++i) {
                        if (typeof d.members[i] === "string")
                            $util.base64.decode(d.members[i], m.members[i] = $util.newBuffer($util.base64.length(d.members[i])), 0);
                        else if (d.members[i].length >= 0)
                            m.members[i] = d.members[i];
                    }
                }
                if (d.admins) {
                    if (!$Array.isArray(d.admins))
                        throw $TypeError(".sma.v1.GroupCreate.admins: array expected");
                    m.admins = $Array(d.admins.length);
                    for (var i = 0; i < d.admins.length; ++i) {
                        if (typeof d.admins[i] === "string")
                            $util.base64.decode(d.admins[i], m.admins[i] = $util.newBuffer($util.base64.length(d.admins[i])), 0);
                        else if (d.admins[i].length >= 0)
                            m.admins[i] = d.admins[i];
                    }
                }
                if (d.metadata != null) {
                    if (!$util.isObject(d.metadata))
                        throw $TypeError(".sma.v1.GroupCreate.metadata: object expected");
                    m.metadata = $root.sma.v1.GroupMetadata.fromObject(d.metadata, q + 1);
                }
                return m;
            };

            GroupCreate.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.arrays || o.defaults) {
                    d.members = [];
                    d.admins = [];
                }
                if (o.defaults) {
                    d.metadata = null;
                }
                if (m.members && m.members.length) {
                    d.members = $Array(m.members.length);
                    for (var j = 0; j < m.members.length; ++j) {
                        d.members[j] = o.bytes === $String ? $util.base64.encode(m.members[j], 0, m.members[j].length) : o.bytes === $Array ? $Array.prototype.slice.call(m.members[j]) : m.members[j];
                    }
                }
                if (m.admins && m.admins.length) {
                    d.admins = $Array(m.admins.length);
                    for (var j = 0; j < m.admins.length; ++j) {
                        d.admins[j] = o.bytes === $String ? $util.base64.encode(m.admins[j], 0, m.admins[j].length) : o.bytes === $Array ? $Array.prototype.slice.call(m.admins[j]) : m.admins[j];
                    }
                }
                if (m.metadata != null && $Object.hasOwnProperty.call(m, "metadata")) {
                    d.metadata = $root.sma.v1.GroupMetadata.toObject(m.metadata, o, q + 1);
                }
                return d;
            };

            GroupCreate.prototype.toJSON = function() {
                return GroupCreate.toObject(this, $protobuf.util.toJSONOptions);
            };

            GroupCreate.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.GroupCreate";
            };

            return GroupCreate;
        })();

        v1.MemberChange = (function() {

            const MemberChange = function (p) {
                this.members = [];
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            MemberChange.prototype.members = $util.emptyArray;

            MemberChange.create = function(properties) {
                return new MemberChange(properties);
            };

            MemberChange.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.members != null && m.members.length) {
                    for (var i = 0; i < m.members.length; ++i)
                        w.uint32(10).bytes(m.members[i]);
                }
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            MemberChange.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.MemberChange();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            if (!(m.members && m.members.length))
                                m.members = [];
                            m.members.push(r.bytes());
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            MemberChange.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.members != null && $Object.hasOwnProperty.call(m, "members")) {
                    if (!$Array.isArray(m.members))
                        return "members: array expected";
                    for (var i = 0; i < m.members.length; ++i) {
                        if (!(m.members[i] && typeof m.members[i].length === "number" || $util.isString(m.members[i])))
                            return "members: buffer[] expected";
                    }
                }
                return null;
            };

            MemberChange.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.MemberChange)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.MemberChange: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.MemberChange();
                if (d.members) {
                    if (!$Array.isArray(d.members))
                        throw $TypeError(".sma.v1.MemberChange.members: array expected");
                    m.members = $Array(d.members.length);
                    for (var i = 0; i < d.members.length; ++i) {
                        if (typeof d.members[i] === "string")
                            $util.base64.decode(d.members[i], m.members[i] = $util.newBuffer($util.base64.length(d.members[i])), 0);
                        else if (d.members[i].length >= 0)
                            m.members[i] = d.members[i];
                    }
                }
                return m;
            };

            MemberChange.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.arrays || o.defaults) {
                    d.members = [];
                }
                if (m.members && m.members.length) {
                    d.members = $Array(m.members.length);
                    for (var j = 0; j < m.members.length; ++j) {
                        d.members[j] = o.bytes === $String ? $util.base64.encode(m.members[j], 0, m.members[j].length) : o.bytes === $Array ? $Array.prototype.slice.call(m.members[j]) : m.members[j];
                    }
                }
                return d;
            };

            MemberChange.prototype.toJSON = function() {
                return MemberChange.toObject(this, $protobuf.util.toJSONOptions);
            };

            MemberChange.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.MemberChange";
            };

            return MemberChange;
        })();

        v1.GroupMetadata = (function() {

            const GroupMetadata = function (p) {
                this.avatarLocators = [];
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            GroupMetadata.prototype.title = "";
            GroupMetadata.prototype.avatarSha256 = $util.newBuffer([]);
            GroupMetadata.prototype.avatarLocators = $util.emptyArray;

            GroupMetadata.create = function(properties) {
                return new GroupMetadata(properties);
            };

            GroupMetadata.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.title != null && $Object.hasOwnProperty.call(m, "title") && m.title !== "")
                    w.uint32(10).string(m.title);
                if (m.avatarSha256 != null && $Object.hasOwnProperty.call(m, "avatarSha256") && m.avatarSha256.length)
                    w.uint32(18).bytes(m.avatarSha256);
                if (m.avatarLocators != null && m.avatarLocators.length) {
                    for (var i = 0; i < m.avatarLocators.length; ++i)
                        $root.sma.v1.Locator.encode(m.avatarLocators[i], w.uint32(26).fork(), q + 1).ldelim();
                }
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            GroupMetadata.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.GroupMetadata();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            if ((v = r.stringVerify()).length)
                                m.title = v;
                            else
                                delete m.title;
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.avatarSha256 = v;
                            else
                                delete m.avatarSha256;
                            continue;
                        }
                    case 3: {
                            if (u !== 2)
                                break;
                            if (!(m.avatarLocators && m.avatarLocators.length))
                                m.avatarLocators = [];
                            m.avatarLocators.push($root.sma.v1.Locator.decode(r, r.size(), $undefined, q + 1));
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            GroupMetadata.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.title != null && $Object.hasOwnProperty.call(m, "title")) {
                    if (!$util.isString(m.title))
                        return "title: string expected";
                }
                if (m.avatarSha256 != null && $Object.hasOwnProperty.call(m, "avatarSha256")) {
                    if (!(m.avatarSha256 && typeof m.avatarSha256.length === "number" || $util.isString(m.avatarSha256)))
                        return "avatarSha256: buffer expected";
                }
                if (m.avatarLocators != null && $Object.hasOwnProperty.call(m, "avatarLocators")) {
                    if (!$Array.isArray(m.avatarLocators))
                        return "avatarLocators: array expected";
                    for (var i = 0; i < m.avatarLocators.length; ++i) {
                        {
                            var e = $root.sma.v1.Locator.verify(m.avatarLocators[i], q + 1);
                            if (e)
                                return "avatarLocators." + e;
                        }
                    }
                }
                return null;
            };

            GroupMetadata.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.GroupMetadata)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.GroupMetadata: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.GroupMetadata();
                if (d.title != null) {
                    if (typeof d.title !== "string" || d.title.length) {
                        m.title = $String(d.title);
                    }
                }
                if (d.avatarSha256 != null) {
                    if (d.avatarSha256.length) {
                        if (typeof d.avatarSha256 === "string")
                            $util.base64.decode(d.avatarSha256, m.avatarSha256 = $util.newBuffer($util.base64.length(d.avatarSha256)), 0);
                        else if (d.avatarSha256.length >= 0)
                            m.avatarSha256 = d.avatarSha256;
                    }
                }
                if (d.avatarLocators) {
                    if (!$Array.isArray(d.avatarLocators))
                        throw $TypeError(".sma.v1.GroupMetadata.avatarLocators: array expected");
                    m.avatarLocators = $Array(d.avatarLocators.length);
                    for (var i = 0; i < d.avatarLocators.length; ++i) {
                        if (!$util.isObject(d.avatarLocators[i]))
                            throw $TypeError(".sma.v1.GroupMetadata.avatarLocators: object expected");
                        m.avatarLocators[i] = $root.sma.v1.Locator.fromObject(d.avatarLocators[i], q + 1);
                    }
                }
                return m;
            };

            GroupMetadata.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.arrays || o.defaults) {
                    d.avatarLocators = [];
                }
                if (o.defaults) {
                    d.title = "";
                    if (o.bytes === $String)
                        d.avatarSha256 = "";
                    else {
                        d.avatarSha256 = [];
                        if (o.bytes !== $Array)
                            d.avatarSha256 = $util.newBuffer(d.avatarSha256);
                    }
                }
                if (m.title != null && $Object.hasOwnProperty.call(m, "title")) {
                    d.title = m.title;
                }
                if (m.avatarSha256 != null && $Object.hasOwnProperty.call(m, "avatarSha256")) {
                    d.avatarSha256 = o.bytes === $String ? $util.base64.encode(m.avatarSha256, 0, m.avatarSha256.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.avatarSha256) : m.avatarSha256;
                }
                if (m.avatarLocators && m.avatarLocators.length) {
                    d.avatarLocators = $Array(m.avatarLocators.length);
                    for (var j = 0; j < m.avatarLocators.length; ++j) {
                        d.avatarLocators[j] = $root.sma.v1.Locator.toObject(m.avatarLocators[j], o, q + 1);
                    }
                }
                return d;
            };

            GroupMetadata.prototype.toJSON = function() {
                return GroupMetadata.toObject(this, $protobuf.util.toJSONOptions);
            };

            GroupMetadata.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.GroupMetadata";
            };

            return GroupMetadata;
        })();

        v1.Receipt = (function() {

            const Receipt = function (p) {
                this.messageIds = [];
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            Receipt.prototype.type = 0;
            Receipt.prototype.messageIds = $util.emptyArray;

            Receipt.create = function(properties) {
                return new Receipt(properties);
            };

            Receipt.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.type != null && $Object.hasOwnProperty.call(m, "type") && m.type !== 0)
                    w.uint32(8).int32(m.type);
                if (m.messageIds != null && m.messageIds.length) {
                    for (var i = 0; i < m.messageIds.length; ++i)
                        w.uint32(18).bytes(m.messageIds[i]);
                }
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            Receipt.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.Receipt();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 0)
                                break;
                            if (v = r.int32())
                                m.type = v;
                            else
                                delete m.type;
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            if (!(m.messageIds && m.messageIds.length))
                                m.messageIds = [];
                            m.messageIds.push(r.bytes());
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            Receipt.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.type != null && $Object.hasOwnProperty.call(m, "type")) {
                    if (typeof m.type !== "number" || (m.type | 0) !== m.type)
                        return "type: enum value expected";
                }
                if (m.messageIds != null && $Object.hasOwnProperty.call(m, "messageIds")) {
                    if (!$Array.isArray(m.messageIds))
                        return "messageIds: array expected";
                    for (var i = 0; i < m.messageIds.length; ++i) {
                        if (!(m.messageIds[i] && typeof m.messageIds[i].length === "number" || $util.isString(m.messageIds[i])))
                            return "messageIds: buffer[] expected";
                    }
                }
                return null;
            };

            Receipt.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.Receipt)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.Receipt: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.Receipt();
                if (d.type !== 0 && (typeof d.type !== "string" || $root.sma.v1.Receipt.Type[d.type] !== 0)) {
                    switch (d.type) {
                    case "TYPE_UNSPECIFIED":
                    case 0:
                        m.type = 0;
                        break;
                    case "DELIVERED":
                    case 1:
                        m.type = 1;
                        break;
                    case "READ":
                    case 2:
                        m.type = 2;
                        break;
                    default:
                        if (typeof d.type === "number" && (d.type | 0) === d.type)
                            m.type = d.type;
                    }
                }
                if (d.messageIds) {
                    if (!$Array.isArray(d.messageIds))
                        throw $TypeError(".sma.v1.Receipt.messageIds: array expected");
                    m.messageIds = $Array(d.messageIds.length);
                    for (var i = 0; i < d.messageIds.length; ++i) {
                        if (typeof d.messageIds[i] === "string")
                            $util.base64.decode(d.messageIds[i], m.messageIds[i] = $util.newBuffer($util.base64.length(d.messageIds[i])), 0);
                        else if (d.messageIds[i].length >= 0)
                            m.messageIds[i] = d.messageIds[i];
                    }
                }
                return m;
            };

            Receipt.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.arrays || o.defaults) {
                    d.messageIds = [];
                }
                if (o.defaults) {
                    d.type = o.enums === $String ? "TYPE_UNSPECIFIED" : 0;
                }
                if (m.type != null && $Object.hasOwnProperty.call(m, "type")) {
                    d.type = o.enums === $String ? $root.sma.v1.Receipt.Type[m.type] === $undefined ? m.type : $root.sma.v1.Receipt.Type[m.type] : m.type;
                }
                if (m.messageIds && m.messageIds.length) {
                    d.messageIds = $Array(m.messageIds.length);
                    for (var j = 0; j < m.messageIds.length; ++j) {
                        d.messageIds[j] = o.bytes === $String ? $util.base64.encode(m.messageIds[j], 0, m.messageIds[j].length) : o.bytes === $Array ? $Array.prototype.slice.call(m.messageIds[j]) : m.messageIds[j];
                    }
                }
                return d;
            };

            Receipt.prototype.toJSON = function() {
                return Receipt.toObject(this, $protobuf.util.toJSONOptions);
            };

            Receipt.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.Receipt";
            };

            Receipt.Type = (function() {
                const valuesById = $Object.create(null), values = $Object.create(valuesById);
                values[valuesById[0] = "TYPE_UNSPECIFIED"] = 0;
                values[valuesById[1] = "DELIVERED"] = 1;
                values[valuesById[2] = "READ"] = 2;
                return values;
            })();

            return Receipt;
        })();

        v1.Reaction = (function() {

            const Reaction = function (p) {
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            Reaction.prototype.targetId = $util.newBuffer([]);
            Reaction.prototype.emoji = "";
            Reaction.prototype.remove = false;

            Reaction.create = function(properties) {
                return new Reaction(properties);
            };

            Reaction.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.targetId != null && $Object.hasOwnProperty.call(m, "targetId") && m.targetId.length)
                    w.uint32(10).bytes(m.targetId);
                if (m.emoji != null && $Object.hasOwnProperty.call(m, "emoji") && m.emoji !== "")
                    w.uint32(18).string(m.emoji);
                if (m.remove != null && $Object.hasOwnProperty.call(m, "remove") && m.remove !== false)
                    w.uint32(24).bool(m.remove);
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            Reaction.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.Reaction();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.targetId = v;
                            else
                                delete m.targetId;
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            if ((v = r.stringVerify()).length)
                                m.emoji = v;
                            else
                                delete m.emoji;
                            continue;
                        }
                    case 3: {
                            if (u !== 0)
                                break;
                            if (v = r.bool())
                                m.remove = v;
                            else
                                delete m.remove;
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            Reaction.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.targetId != null && $Object.hasOwnProperty.call(m, "targetId")) {
                    if (!(m.targetId && typeof m.targetId.length === "number" || $util.isString(m.targetId)))
                        return "targetId: buffer expected";
                }
                if (m.emoji != null && $Object.hasOwnProperty.call(m, "emoji")) {
                    if (!$util.isString(m.emoji))
                        return "emoji: string expected";
                }
                if (m.remove != null && $Object.hasOwnProperty.call(m, "remove")) {
                    if (typeof m.remove !== "boolean")
                        return "remove: boolean expected";
                }
                return null;
            };

            Reaction.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.Reaction)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.Reaction: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.Reaction();
                if (d.targetId != null) {
                    if (d.targetId.length) {
                        if (typeof d.targetId === "string")
                            $util.base64.decode(d.targetId, m.targetId = $util.newBuffer($util.base64.length(d.targetId)), 0);
                        else if (d.targetId.length >= 0)
                            m.targetId = d.targetId;
                    }
                }
                if (d.emoji != null) {
                    if (typeof d.emoji !== "string" || d.emoji.length) {
                        m.emoji = $String(d.emoji);
                    }
                }
                if (d.remove != null) {
                    if (d.remove) {
                        m.remove = $Boolean(d.remove);
                    }
                }
                return m;
            };

            Reaction.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.defaults) {
                    if (o.bytes === $String)
                        d.targetId = "";
                    else {
                        d.targetId = [];
                        if (o.bytes !== $Array)
                            d.targetId = $util.newBuffer(d.targetId);
                    }
                    d.emoji = "";
                    d.remove = false;
                }
                if (m.targetId != null && $Object.hasOwnProperty.call(m, "targetId")) {
                    d.targetId = o.bytes === $String ? $util.base64.encode(m.targetId, 0, m.targetId.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.targetId) : m.targetId;
                }
                if (m.emoji != null && $Object.hasOwnProperty.call(m, "emoji")) {
                    d.emoji = m.emoji;
                }
                if (m.remove != null && $Object.hasOwnProperty.call(m, "remove")) {
                    d.remove = m.remove;
                }
                return d;
            };

            Reaction.prototype.toJSON = function() {
                return Reaction.toObject(this, $protobuf.util.toJSONOptions);
            };

            Reaction.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.Reaction";
            };

            return Reaction;
        })();

        v1.Edit = (function() {

            const Edit = function (p) {
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            Edit.prototype.targetId = $util.newBuffer([]);
            Edit.prototype.text = null;

            Edit.create = function(properties) {
                return new Edit(properties);
            };

            Edit.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.targetId != null && $Object.hasOwnProperty.call(m, "targetId") && m.targetId.length)
                    w.uint32(10).bytes(m.targetId);
                if (m.text != null && $Object.hasOwnProperty.call(m, "text"))
                    $root.sma.v1.Text.encode(m.text, w.uint32(18).fork(), q + 1).ldelim();
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            Edit.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.Edit();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.targetId = v;
                            else
                                delete m.targetId;
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            m.text = $root.sma.v1.Text.decode(r, r.size(), $undefined, q + 1, m.text);
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            Edit.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.targetId != null && $Object.hasOwnProperty.call(m, "targetId")) {
                    if (!(m.targetId && typeof m.targetId.length === "number" || $util.isString(m.targetId)))
                        return "targetId: buffer expected";
                }
                if (m.text != null && $Object.hasOwnProperty.call(m, "text")) {
                    {
                        var e = $root.sma.v1.Text.verify(m.text, q + 1);
                        if (e)
                            return "text." + e;
                    }
                }
                return null;
            };

            Edit.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.Edit)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.Edit: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.Edit();
                if (d.targetId != null) {
                    if (d.targetId.length) {
                        if (typeof d.targetId === "string")
                            $util.base64.decode(d.targetId, m.targetId = $util.newBuffer($util.base64.length(d.targetId)), 0);
                        else if (d.targetId.length >= 0)
                            m.targetId = d.targetId;
                    }
                }
                if (d.text != null) {
                    if (!$util.isObject(d.text))
                        throw $TypeError(".sma.v1.Edit.text: object expected");
                    m.text = $root.sma.v1.Text.fromObject(d.text, q + 1);
                }
                return m;
            };

            Edit.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.defaults) {
                    if (o.bytes === $String)
                        d.targetId = "";
                    else {
                        d.targetId = [];
                        if (o.bytes !== $Array)
                            d.targetId = $util.newBuffer(d.targetId);
                    }
                    d.text = null;
                }
                if (m.targetId != null && $Object.hasOwnProperty.call(m, "targetId")) {
                    d.targetId = o.bytes === $String ? $util.base64.encode(m.targetId, 0, m.targetId.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.targetId) : m.targetId;
                }
                if (m.text != null && $Object.hasOwnProperty.call(m, "text")) {
                    d.text = $root.sma.v1.Text.toObject(m.text, o, q + 1);
                }
                return d;
            };

            Edit.prototype.toJSON = function() {
                return Edit.toObject(this, $protobuf.util.toJSONOptions);
            };

            Edit.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.Edit";
            };

            return Edit;
        })();

        v1.Delete = (function() {

            const Delete = function (p) {
                this.targetIds = [];
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            Delete.prototype.targetIds = $util.emptyArray;

            Delete.create = function(properties) {
                return new Delete(properties);
            };

            Delete.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.targetIds != null && m.targetIds.length) {
                    for (var i = 0; i < m.targetIds.length; ++i)
                        w.uint32(10).bytes(m.targetIds[i]);
                }
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            Delete.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.Delete();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            if (!(m.targetIds && m.targetIds.length))
                                m.targetIds = [];
                            m.targetIds.push(r.bytes());
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            Delete.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.targetIds != null && $Object.hasOwnProperty.call(m, "targetIds")) {
                    if (!$Array.isArray(m.targetIds))
                        return "targetIds: array expected";
                    for (var i = 0; i < m.targetIds.length; ++i) {
                        if (!(m.targetIds[i] && typeof m.targetIds[i].length === "number" || $util.isString(m.targetIds[i])))
                            return "targetIds: buffer[] expected";
                    }
                }
                return null;
            };

            Delete.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.Delete)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.Delete: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.Delete();
                if (d.targetIds) {
                    if (!$Array.isArray(d.targetIds))
                        throw $TypeError(".sma.v1.Delete.targetIds: array expected");
                    m.targetIds = $Array(d.targetIds.length);
                    for (var i = 0; i < d.targetIds.length; ++i) {
                        if (typeof d.targetIds[i] === "string")
                            $util.base64.decode(d.targetIds[i], m.targetIds[i] = $util.newBuffer($util.base64.length(d.targetIds[i])), 0);
                        else if (d.targetIds[i].length >= 0)
                            m.targetIds[i] = d.targetIds[i];
                    }
                }
                return m;
            };

            Delete.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.arrays || o.defaults) {
                    d.targetIds = [];
                }
                if (m.targetIds && m.targetIds.length) {
                    d.targetIds = $Array(m.targetIds.length);
                    for (var j = 0; j < m.targetIds.length; ++j) {
                        d.targetIds[j] = o.bytes === $String ? $util.base64.encode(m.targetIds[j], 0, m.targetIds[j].length) : o.bytes === $Array ? $Array.prototype.slice.call(m.targetIds[j]) : m.targetIds[j];
                    }
                }
                return d;
            };

            Delete.prototype.toJSON = function() {
                return Delete.toObject(this, $protobuf.util.toJSONOptions);
            };

            Delete.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.Delete";
            };

            return Delete;
        })();

        v1.Typing = (function() {

            const Typing = function (p) {
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            Typing.prototype.started = false;

            Typing.create = function(properties) {
                return new Typing(properties);
            };

            Typing.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.started != null && $Object.hasOwnProperty.call(m, "started") && m.started !== false)
                    w.uint32(8).bool(m.started);
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            Typing.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.Typing();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 0)
                                break;
                            if (v = r.bool())
                                m.started = v;
                            else
                                delete m.started;
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            Typing.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.started != null && $Object.hasOwnProperty.call(m, "started")) {
                    if (typeof m.started !== "boolean")
                        return "started: boolean expected";
                }
                return null;
            };

            Typing.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.Typing)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.Typing: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.Typing();
                if (d.started != null) {
                    if (d.started) {
                        m.started = $Boolean(d.started);
                    }
                }
                return m;
            };

            Typing.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.defaults) {
                    d.started = false;
                }
                if (m.started != null && $Object.hasOwnProperty.call(m, "started")) {
                    d.started = m.started;
                }
                return d;
            };

            Typing.prototype.toJSON = function() {
                return Typing.toObject(this, $protobuf.util.toJSONOptions);
            };

            Typing.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.Typing";
            };

            return Typing;
        })();

        v1.DeviceSync = (function() {

            const DeviceSync = function (p) {
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            DeviceSync.prototype.newDevice = null;
            DeviceSync.prototype.revokedDeviceId = null;
            DeviceSync.prototype.contactsSnapshotSha256 = null;
            DeviceSync.prototype.historySnapshot = null;

            let $oneOfFields;

            $Object.defineProperty(DeviceSync.prototype, "kind", {
                get: $util.oneOfGetter($oneOfFields = ["newDevice", "revokedDeviceId", "contactsSnapshotSha256", "historySnapshot"]),
                set: $util.oneOfSetter($oneOfFields)
            });

            DeviceSync.create = function(properties) {
                return new DeviceSync(properties);
            };

            DeviceSync.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.newDevice != null && $Object.hasOwnProperty.call(m, "newDevice"))
                    $root.sma.v1.SignedBlob.encode(m.newDevice, w.uint32(10).fork(), q + 1).ldelim();
                if (m.revokedDeviceId != null && $Object.hasOwnProperty.call(m, "revokedDeviceId"))
                    w.uint32(18).bytes(m.revokedDeviceId);
                if (m.contactsSnapshotSha256 != null && $Object.hasOwnProperty.call(m, "contactsSnapshotSha256"))
                    w.uint32(26).bytes(m.contactsSnapshotSha256);
                if (m.historySnapshot != null && $Object.hasOwnProperty.call(m, "historySnapshot"))
                    $root.sma.v1.BlobRef.encode(m.historySnapshot, w.uint32(34).fork(), q + 1).ldelim();
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            DeviceSync.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.DeviceSync();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            m.newDevice = $root.sma.v1.SignedBlob.decode(r, r.size(), $undefined, q + 1, m.newDevice);
                            m.kind = "newDevice";
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            m.revokedDeviceId = r.bytes();
                            m.kind = "revokedDeviceId";
                            continue;
                        }
                    case 3: {
                            if (u !== 2)
                                break;
                            m.contactsSnapshotSha256 = r.bytes();
                            m.kind = "contactsSnapshotSha256";
                            continue;
                        }
                    case 4: {
                            if (u !== 2)
                                break;
                            m.historySnapshot = $root.sma.v1.BlobRef.decode(r, r.size(), $undefined, q + 1, m.historySnapshot);
                            m.kind = "historySnapshot";
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            DeviceSync.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                var p = {};
                if (m.newDevice != null && $Object.hasOwnProperty.call(m, "newDevice")) {
                    p.kind = 1;
                    {
                        var e = $root.sma.v1.SignedBlob.verify(m.newDevice, q + 1);
                        if (e)
                            return "newDevice." + e;
                    }
                }
                if (m.revokedDeviceId != null && $Object.hasOwnProperty.call(m, "revokedDeviceId")) {
                    if (p.kind === 1)
                        return "kind: multiple values";
                    p.kind = 1;
                    if (!(m.revokedDeviceId && typeof m.revokedDeviceId.length === "number" || $util.isString(m.revokedDeviceId)))
                        return "revokedDeviceId: buffer expected";
                }
                if (m.contactsSnapshotSha256 != null && $Object.hasOwnProperty.call(m, "contactsSnapshotSha256")) {
                    if (p.kind === 1)
                        return "kind: multiple values";
                    p.kind = 1;
                    if (!(m.contactsSnapshotSha256 && typeof m.contactsSnapshotSha256.length === "number" || $util.isString(m.contactsSnapshotSha256)))
                        return "contactsSnapshotSha256: buffer expected";
                }
                if (m.historySnapshot != null && $Object.hasOwnProperty.call(m, "historySnapshot")) {
                    if (p.kind === 1)
                        return "kind: multiple values";
                    p.kind = 1;
                    {
                        var e = $root.sma.v1.BlobRef.verify(m.historySnapshot, q + 1);
                        if (e)
                            return "historySnapshot." + e;
                    }
                }
                return null;
            };

            DeviceSync.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.DeviceSync)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.DeviceSync: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.DeviceSync();
                if (d.newDevice != null) {
                    if (!$util.isObject(d.newDevice))
                        throw $TypeError(".sma.v1.DeviceSync.newDevice: object expected");
                    m.newDevice = $root.sma.v1.SignedBlob.fromObject(d.newDevice, q + 1);
                }
                if (d.revokedDeviceId != null) {
                    if (typeof d.revokedDeviceId === "string")
                        $util.base64.decode(d.revokedDeviceId, m.revokedDeviceId = $util.newBuffer($util.base64.length(d.revokedDeviceId)), 0);
                    else if (d.revokedDeviceId.length >= 0)
                        m.revokedDeviceId = d.revokedDeviceId;
                }
                if (d.contactsSnapshotSha256 != null) {
                    if (typeof d.contactsSnapshotSha256 === "string")
                        $util.base64.decode(d.contactsSnapshotSha256, m.contactsSnapshotSha256 = $util.newBuffer($util.base64.length(d.contactsSnapshotSha256)), 0);
                    else if (d.contactsSnapshotSha256.length >= 0)
                        m.contactsSnapshotSha256 = d.contactsSnapshotSha256;
                }
                if (d.historySnapshot != null) {
                    if (!$util.isObject(d.historySnapshot))
                        throw $TypeError(".sma.v1.DeviceSync.historySnapshot: object expected");
                    m.historySnapshot = $root.sma.v1.BlobRef.fromObject(d.historySnapshot, q + 1);
                }
                return m;
            };

            DeviceSync.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (m.newDevice != null && $Object.hasOwnProperty.call(m, "newDevice")) {
                    d.newDevice = $root.sma.v1.SignedBlob.toObject(m.newDevice, o, q + 1);
                    if (o.oneofs)
                        d.kind = "newDevice";
                }
                if (m.revokedDeviceId != null && $Object.hasOwnProperty.call(m, "revokedDeviceId")) {
                    d.revokedDeviceId = o.bytes === $String ? $util.base64.encode(m.revokedDeviceId, 0, m.revokedDeviceId.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.revokedDeviceId) : m.revokedDeviceId;
                    if (o.oneofs)
                        d.kind = "revokedDeviceId";
                }
                if (m.contactsSnapshotSha256 != null && $Object.hasOwnProperty.call(m, "contactsSnapshotSha256")) {
                    d.contactsSnapshotSha256 = o.bytes === $String ? $util.base64.encode(m.contactsSnapshotSha256, 0, m.contactsSnapshotSha256.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.contactsSnapshotSha256) : m.contactsSnapshotSha256;
                    if (o.oneofs)
                        d.kind = "contactsSnapshotSha256";
                }
                if (m.historySnapshot != null && $Object.hasOwnProperty.call(m, "historySnapshot")) {
                    d.historySnapshot = $root.sma.v1.BlobRef.toObject(m.historySnapshot, o, q + 1);
                    if (o.oneofs)
                        d.kind = "historySnapshot";
                }
                return d;
            };

            DeviceSync.prototype.toJSON = function() {
                return DeviceSync.toObject(this, $protobuf.util.toJSONOptions);
            };

            DeviceSync.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.DeviceSync";
            };

            return DeviceSync;
        })();

        v1.PrekeyRefresh = (function() {

            const PrekeyRefresh = function (p) {
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            PrekeyRefresh.prototype.bundle = null;

            PrekeyRefresh.create = function(properties) {
                return new PrekeyRefresh(properties);
            };

            PrekeyRefresh.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.bundle != null && $Object.hasOwnProperty.call(m, "bundle"))
                    $root.sma.v1.SignedBlob.encode(m.bundle, w.uint32(10).fork(), q + 1).ldelim();
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            PrekeyRefresh.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.PrekeyRefresh();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            m.bundle = $root.sma.v1.SignedBlob.decode(r, r.size(), $undefined, q + 1, m.bundle);
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            PrekeyRefresh.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.bundle != null && $Object.hasOwnProperty.call(m, "bundle")) {
                    {
                        var e = $root.sma.v1.SignedBlob.verify(m.bundle, q + 1);
                        if (e)
                            return "bundle." + e;
                    }
                }
                return null;
            };

            PrekeyRefresh.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.PrekeyRefresh)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.PrekeyRefresh: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.PrekeyRefresh();
                if (d.bundle != null) {
                    if (!$util.isObject(d.bundle))
                        throw $TypeError(".sma.v1.PrekeyRefresh.bundle: object expected");
                    m.bundle = $root.sma.v1.SignedBlob.fromObject(d.bundle, q + 1);
                }
                return m;
            };

            PrekeyRefresh.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.defaults) {
                    d.bundle = null;
                }
                if (m.bundle != null && $Object.hasOwnProperty.call(m, "bundle")) {
                    d.bundle = $root.sma.v1.SignedBlob.toObject(m.bundle, o, q + 1);
                }
                return d;
            };

            PrekeyRefresh.prototype.toJSON = function() {
                return PrekeyRefresh.toObject(this, $protobuf.util.toJSONOptions);
            };

            PrekeyRefresh.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.PrekeyRefresh";
            };

            return PrekeyRefresh;
        })();

        v1.PluginMessage = (function() {

            const PluginMessage = function (p) {
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            PluginMessage.prototype.pluginId = "";
            PluginMessage.prototype.schemaVersion = 0;
            PluginMessage.prototype.payload = $util.newBuffer([]);

            PluginMessage.create = function(properties) {
                return new PluginMessage(properties);
            };

            PluginMessage.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.pluginId != null && $Object.hasOwnProperty.call(m, "pluginId") && m.pluginId !== "")
                    w.uint32(10).string(m.pluginId);
                if (m.schemaVersion != null && $Object.hasOwnProperty.call(m, "schemaVersion") && m.schemaVersion !== 0)
                    w.uint32(16).uint32(m.schemaVersion);
                if (m.payload != null && $Object.hasOwnProperty.call(m, "payload") && m.payload.length)
                    w.uint32(26).bytes(m.payload);
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            PluginMessage.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.PluginMessage();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            if ((v = r.stringVerify()).length)
                                m.pluginId = v;
                            else
                                delete m.pluginId;
                            continue;
                        }
                    case 2: {
                            if (u !== 0)
                                break;
                            if (v = r.uint32())
                                m.schemaVersion = v;
                            else
                                delete m.schemaVersion;
                            continue;
                        }
                    case 3: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.payload = v;
                            else
                                delete m.payload;
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            PluginMessage.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.pluginId != null && $Object.hasOwnProperty.call(m, "pluginId")) {
                    if (!$util.isString(m.pluginId))
                        return "pluginId: string expected";
                }
                if (m.schemaVersion != null && $Object.hasOwnProperty.call(m, "schemaVersion")) {
                    if (!$util.isInteger(m.schemaVersion))
                        return "schemaVersion: integer expected";
                }
                if (m.payload != null && $Object.hasOwnProperty.call(m, "payload")) {
                    if (!(m.payload && typeof m.payload.length === "number" || $util.isString(m.payload)))
                        return "payload: buffer expected";
                }
                return null;
            };

            PluginMessage.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.PluginMessage)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.PluginMessage: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.PluginMessage();
                if (d.pluginId != null) {
                    if (typeof d.pluginId !== "string" || d.pluginId.length) {
                        m.pluginId = $String(d.pluginId);
                    }
                }
                if (d.schemaVersion != null) {
                    if ($Number(d.schemaVersion) !== 0) {
                        m.schemaVersion = d.schemaVersion >>> 0;
                    }
                }
                if (d.payload != null) {
                    if (d.payload.length) {
                        if (typeof d.payload === "string")
                            $util.base64.decode(d.payload, m.payload = $util.newBuffer($util.base64.length(d.payload)), 0);
                        else if (d.payload.length >= 0)
                            m.payload = d.payload;
                    }
                }
                return m;
            };

            PluginMessage.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.defaults) {
                    d.pluginId = "";
                    d.schemaVersion = 0;
                    if (o.bytes === $String)
                        d.payload = "";
                    else {
                        d.payload = [];
                        if (o.bytes !== $Array)
                            d.payload = $util.newBuffer(d.payload);
                    }
                }
                if (m.pluginId != null && $Object.hasOwnProperty.call(m, "pluginId")) {
                    d.pluginId = m.pluginId;
                }
                if (m.schemaVersion != null && $Object.hasOwnProperty.call(m, "schemaVersion")) {
                    d.schemaVersion = m.schemaVersion;
                }
                if (m.payload != null && $Object.hasOwnProperty.call(m, "payload")) {
                    d.payload = o.bytes === $String ? $util.base64.encode(m.payload, 0, m.payload.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.payload) : m.payload;
                }
                return d;
            };

            PluginMessage.prototype.toJSON = function() {
                return PluginMessage.toObject(this, $protobuf.util.toJSONOptions);
            };

            PluginMessage.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.PluginMessage";
            };

            return PluginMessage;
        })();

        v1.PluginManifest = (function() {

            const PluginManifest = function (p) {
                this.permissions = [];
                this.bundleLocators = [];
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            PluginManifest.prototype.id = "";
            PluginManifest.prototype.name = "";
            PluginManifest.prototype.version = "";
            PluginManifest.prototype.developerKey = $util.newBuffer([]);
            PluginManifest.prototype.permissions = $util.emptyArray;
            PluginManifest.prototype.bundleSha256 = $util.newBuffer([]);
            PluginManifest.prototype.bundleLocators = $util.emptyArray;

            PluginManifest.create = function(properties) {
                return new PluginManifest(properties);
            };

            PluginManifest.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.id != null && $Object.hasOwnProperty.call(m, "id") && m.id !== "")
                    w.uint32(10).string(m.id);
                if (m.name != null && $Object.hasOwnProperty.call(m, "name") && m.name !== "")
                    w.uint32(18).string(m.name);
                if (m.version != null && $Object.hasOwnProperty.call(m, "version") && m.version !== "")
                    w.uint32(26).string(m.version);
                if (m.developerKey != null && $Object.hasOwnProperty.call(m, "developerKey") && m.developerKey.length)
                    w.uint32(34).bytes(m.developerKey);
                if (m.permissions != null && m.permissions.length) {
                    for (var i = 0; i < m.permissions.length; ++i)
                        w.uint32(42).string(m.permissions[i]);
                }
                if (m.bundleSha256 != null && $Object.hasOwnProperty.call(m, "bundleSha256") && m.bundleSha256.length)
                    w.uint32(50).bytes(m.bundleSha256);
                if (m.bundleLocators != null && m.bundleLocators.length) {
                    for (var i = 0; i < m.bundleLocators.length; ++i)
                        $root.sma.v1.Locator.encode(m.bundleLocators[i], w.uint32(58).fork(), q + 1).ldelim();
                }
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            PluginManifest.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.PluginManifest();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 2)
                                break;
                            if ((v = r.stringVerify()).length)
                                m.id = v;
                            else
                                delete m.id;
                            continue;
                        }
                    case 2: {
                            if (u !== 2)
                                break;
                            if ((v = r.stringVerify()).length)
                                m.name = v;
                            else
                                delete m.name;
                            continue;
                        }
                    case 3: {
                            if (u !== 2)
                                break;
                            if ((v = r.stringVerify()).length)
                                m.version = v;
                            else
                                delete m.version;
                            continue;
                        }
                    case 4: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.developerKey = v;
                            else
                                delete m.developerKey;
                            continue;
                        }
                    case 5: {
                            if (u !== 2)
                                break;
                            if (!(m.permissions && m.permissions.length))
                                m.permissions = [];
                            m.permissions.push(r.stringVerify());
                            continue;
                        }
                    case 6: {
                            if (u !== 2)
                                break;
                            if ((v = r.bytes()).length)
                                m.bundleSha256 = v;
                            else
                                delete m.bundleSha256;
                            continue;
                        }
                    case 7: {
                            if (u !== 2)
                                break;
                            if (!(m.bundleLocators && m.bundleLocators.length))
                                m.bundleLocators = [];
                            m.bundleLocators.push($root.sma.v1.Locator.decode(r, r.size(), $undefined, q + 1));
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            PluginManifest.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.id != null && $Object.hasOwnProperty.call(m, "id")) {
                    if (!$util.isString(m.id))
                        return "id: string expected";
                }
                if (m.name != null && $Object.hasOwnProperty.call(m, "name")) {
                    if (!$util.isString(m.name))
                        return "name: string expected";
                }
                if (m.version != null && $Object.hasOwnProperty.call(m, "version")) {
                    if (!$util.isString(m.version))
                        return "version: string expected";
                }
                if (m.developerKey != null && $Object.hasOwnProperty.call(m, "developerKey")) {
                    if (!(m.developerKey && typeof m.developerKey.length === "number" || $util.isString(m.developerKey)))
                        return "developerKey: buffer expected";
                }
                if (m.permissions != null && $Object.hasOwnProperty.call(m, "permissions")) {
                    if (!$Array.isArray(m.permissions))
                        return "permissions: array expected";
                    for (var i = 0; i < m.permissions.length; ++i) {
                        if (!$util.isString(m.permissions[i]))
                            return "permissions: string[] expected";
                    }
                }
                if (m.bundleSha256 != null && $Object.hasOwnProperty.call(m, "bundleSha256")) {
                    if (!(m.bundleSha256 && typeof m.bundleSha256.length === "number" || $util.isString(m.bundleSha256)))
                        return "bundleSha256: buffer expected";
                }
                if (m.bundleLocators != null && $Object.hasOwnProperty.call(m, "bundleLocators")) {
                    if (!$Array.isArray(m.bundleLocators))
                        return "bundleLocators: array expected";
                    for (var i = 0; i < m.bundleLocators.length; ++i) {
                        {
                            var e = $root.sma.v1.Locator.verify(m.bundleLocators[i], q + 1);
                            if (e)
                                return "bundleLocators." + e;
                        }
                    }
                }
                return null;
            };

            PluginManifest.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.PluginManifest)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.PluginManifest: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.PluginManifest();
                if (d.id != null) {
                    if (typeof d.id !== "string" || d.id.length) {
                        m.id = $String(d.id);
                    }
                }
                if (d.name != null) {
                    if (typeof d.name !== "string" || d.name.length) {
                        m.name = $String(d.name);
                    }
                }
                if (d.version != null) {
                    if (typeof d.version !== "string" || d.version.length) {
                        m.version = $String(d.version);
                    }
                }
                if (d.developerKey != null) {
                    if (d.developerKey.length) {
                        if (typeof d.developerKey === "string")
                            $util.base64.decode(d.developerKey, m.developerKey = $util.newBuffer($util.base64.length(d.developerKey)), 0);
                        else if (d.developerKey.length >= 0)
                            m.developerKey = d.developerKey;
                    }
                }
                if (d.permissions) {
                    if (!$Array.isArray(d.permissions))
                        throw $TypeError(".sma.v1.PluginManifest.permissions: array expected");
                    m.permissions = $Array(d.permissions.length);
                    for (var i = 0; i < d.permissions.length; ++i) {
                        m.permissions[i] = $String(d.permissions[i]);
                    }
                }
                if (d.bundleSha256 != null) {
                    if (d.bundleSha256.length) {
                        if (typeof d.bundleSha256 === "string")
                            $util.base64.decode(d.bundleSha256, m.bundleSha256 = $util.newBuffer($util.base64.length(d.bundleSha256)), 0);
                        else if (d.bundleSha256.length >= 0)
                            m.bundleSha256 = d.bundleSha256;
                    }
                }
                if (d.bundleLocators) {
                    if (!$Array.isArray(d.bundleLocators))
                        throw $TypeError(".sma.v1.PluginManifest.bundleLocators: array expected");
                    m.bundleLocators = $Array(d.bundleLocators.length);
                    for (var i = 0; i < d.bundleLocators.length; ++i) {
                        if (!$util.isObject(d.bundleLocators[i]))
                            throw $TypeError(".sma.v1.PluginManifest.bundleLocators: object expected");
                        m.bundleLocators[i] = $root.sma.v1.Locator.fromObject(d.bundleLocators[i], q + 1);
                    }
                }
                return m;
            };

            PluginManifest.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.arrays || o.defaults) {
                    d.permissions = [];
                    d.bundleLocators = [];
                }
                if (o.defaults) {
                    d.id = "";
                    d.name = "";
                    d.version = "";
                    if (o.bytes === $String)
                        d.developerKey = "";
                    else {
                        d.developerKey = [];
                        if (o.bytes !== $Array)
                            d.developerKey = $util.newBuffer(d.developerKey);
                    }
                    if (o.bytes === $String)
                        d.bundleSha256 = "";
                    else {
                        d.bundleSha256 = [];
                        if (o.bytes !== $Array)
                            d.bundleSha256 = $util.newBuffer(d.bundleSha256);
                    }
                }
                if (m.id != null && $Object.hasOwnProperty.call(m, "id")) {
                    d.id = m.id;
                }
                if (m.name != null && $Object.hasOwnProperty.call(m, "name")) {
                    d.name = m.name;
                }
                if (m.version != null && $Object.hasOwnProperty.call(m, "version")) {
                    d.version = m.version;
                }
                if (m.developerKey != null && $Object.hasOwnProperty.call(m, "developerKey")) {
                    d.developerKey = o.bytes === $String ? $util.base64.encode(m.developerKey, 0, m.developerKey.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.developerKey) : m.developerKey;
                }
                if (m.permissions && m.permissions.length) {
                    d.permissions = $Array(m.permissions.length);
                    for (var j = 0; j < m.permissions.length; ++j) {
                        d.permissions[j] = m.permissions[j];
                    }
                }
                if (m.bundleSha256 != null && $Object.hasOwnProperty.call(m, "bundleSha256")) {
                    d.bundleSha256 = o.bytes === $String ? $util.base64.encode(m.bundleSha256, 0, m.bundleSha256.length) : o.bytes === $Array ? $Array.prototype.slice.call(m.bundleSha256) : m.bundleSha256;
                }
                if (m.bundleLocators && m.bundleLocators.length) {
                    d.bundleLocators = $Array(m.bundleLocators.length);
                    for (var j = 0; j < m.bundleLocators.length; ++j) {
                        d.bundleLocators[j] = $root.sma.v1.Locator.toObject(m.bundleLocators[j], o, q + 1);
                    }
                }
                return d;
            };

            PluginManifest.prototype.toJSON = function() {
                return PluginManifest.toObject(this, $protobuf.util.toJSONOptions);
            };

            PluginManifest.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.PluginManifest";
            };

            return PluginManifest;
        })();

        v1.BackupManifest = (function() {

            const BackupManifest = function (p) {
                this.contacts = [];
                this.groups = [];
                this.history = [];
                if (p)
                    for (var ks = $Object.keys(p), i = 0; i < ks.length; ++i)
                        if (p[ks[i]] != null && ks[i] !== "__proto__")
                            this[ks[i]] = p[ks[i]];
            };

            BackupManifest.prototype.version = 0;
            BackupManifest.prototype.createdAtMs = $util.Long ? $util.Long.fromBits(0,0,true) : 0;
            BackupManifest.prototype.contacts = $util.emptyArray;
            BackupManifest.prototype.groups = $util.emptyArray;
            BackupManifest.prototype.history = $util.emptyArray;

            BackupManifest.create = function(properties) {
                return new BackupManifest(properties);
            };

            BackupManifest.encode = function (m, w, q) {
                if (!w)
                    w = $Writer.create();
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                if (m.version != null && $Object.hasOwnProperty.call(m, "version") && m.version !== 0)
                    w.uint32(8).uint32(m.version);
                if (m.createdAtMs != null && $Object.hasOwnProperty.call(m, "createdAtMs") && (typeof m.createdAtMs === "object" ? m.createdAtMs.low || m.createdAtMs.high : m.createdAtMs !== 0))
                    w.uint32(16).uint64(m.createdAtMs);
                if (m.contacts != null && m.contacts.length) {
                    for (var i = 0; i < m.contacts.length; ++i)
                        $root.sma.v1.BlobRef.encode(m.contacts[i], w.uint32(26).fork(), q + 1).ldelim();
                }
                if (m.groups != null && m.groups.length) {
                    for (var i = 0; i < m.groups.length; ++i)
                        $root.sma.v1.BlobRef.encode(m.groups[i], w.uint32(34).fork(), q + 1).ldelim();
                }
                if (m.history != null && m.history.length) {
                    for (var i = 0; i < m.history.length; ++i)
                        $root.sma.v1.BlobRef.encode(m.history[i], w.uint32(42).fork(), q + 1).ldelim();
                }
                if (m.$unknowns != null && $Object.hasOwnProperty.call(m, "$unknowns"))
                    for (var i = 0; i < m.$unknowns.length; ++i)
                        w.raw(m.$unknowns[i]);
                return w;
            };

            BackupManifest.decode = function (r, l, z, q, g) {
                if (!(r instanceof $Reader))
                    r = $Reader.create(r);
                if (q === $undefined)
                    q = 0;
                if (q > $Reader.recursionLimit)
                    throw $Error("max depth exceeded");
                var c, m, v;
                if (l === $undefined)
                    c = r.len;
                else {
                    c = r.pos + l;
                    if (c > r.len)
                        throw $RangeError("index out of range");
                    l = r.len;
                    r.len = c;
                }
                m = g || new $root.sma.v1.BackupManifest();
                while (r.pos < c) {
                    var s = r.pos;
                    var t = r.tag();
                    if (t === z) {
                        z = $undefined;
                        break;
                    }
                    var u = t & 7;
                    switch (t >>>= 3) {
                    case 1: {
                            if (u !== 0)
                                break;
                            if (v = r.uint32())
                                m.version = v;
                            else
                                delete m.version;
                            continue;
                        }
                    case 2: {
                            if (u !== 0)
                                break;
                            if (typeof (v = r.uint64()) === "object" ? v.low || v.high : v !== 0)
                                m.createdAtMs = v;
                            else
                                delete m.createdAtMs;
                            continue;
                        }
                    case 3: {
                            if (u !== 2)
                                break;
                            if (!(m.contacts && m.contacts.length))
                                m.contacts = [];
                            m.contacts.push($root.sma.v1.BlobRef.decode(r, r.size(), $undefined, q + 1));
                            continue;
                        }
                    case 4: {
                            if (u !== 2)
                                break;
                            if (!(m.groups && m.groups.length))
                                m.groups = [];
                            m.groups.push($root.sma.v1.BlobRef.decode(r, r.size(), $undefined, q + 1));
                            continue;
                        }
                    case 5: {
                            if (u !== 2)
                                break;
                            if (!(m.history && m.history.length))
                                m.history = [];
                            m.history.push($root.sma.v1.BlobRef.decode(r, r.size(), $undefined, q + 1));
                            continue;
                        }
                    }
                    r.skipType(u, q, t);
                    if (!r.discardUnknown) {
                        $util.makeProp(m, "$unknowns", false);
                        (m.$unknowns || (m.$unknowns = [])).push(r.raw(s, r.pos));
                    }
                }
                if (l !== $undefined) {
                    if (r.pos !== c)
                        throw $RangeError("index out of range");
                    r.len = l;
                }
                if (z !== $undefined)
                    throw $Error("missing end group");
                return m;
            };

            BackupManifest.verify = function (m, q) {
                if (typeof m !== "object" || m === null)
                    return "object expected";
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    return "max depth exceeded";
                if (m.version != null && $Object.hasOwnProperty.call(m, "version")) {
                    if (!$util.isInteger(m.version))
                        return "version: integer expected";
                }
                if (m.createdAtMs != null && $Object.hasOwnProperty.call(m, "createdAtMs")) {
                    if (!$util.isInteger(m.createdAtMs) && !(m.createdAtMs && $util.isInteger(m.createdAtMs.low) && $util.isInteger(m.createdAtMs.high)))
                        return "createdAtMs: integer|Long expected";
                }
                if (m.contacts != null && $Object.hasOwnProperty.call(m, "contacts")) {
                    if (!$Array.isArray(m.contacts))
                        return "contacts: array expected";
                    for (var i = 0; i < m.contacts.length; ++i) {
                        {
                            var e = $root.sma.v1.BlobRef.verify(m.contacts[i], q + 1);
                            if (e)
                                return "contacts." + e;
                        }
                    }
                }
                if (m.groups != null && $Object.hasOwnProperty.call(m, "groups")) {
                    if (!$Array.isArray(m.groups))
                        return "groups: array expected";
                    for (var i = 0; i < m.groups.length; ++i) {
                        {
                            var e = $root.sma.v1.BlobRef.verify(m.groups[i], q + 1);
                            if (e)
                                return "groups." + e;
                        }
                    }
                }
                if (m.history != null && $Object.hasOwnProperty.call(m, "history")) {
                    if (!$Array.isArray(m.history))
                        return "history: array expected";
                    for (var i = 0; i < m.history.length; ++i) {
                        {
                            var e = $root.sma.v1.BlobRef.verify(m.history[i], q + 1);
                            if (e)
                                return "history." + e;
                        }
                    }
                }
                return null;
            };

            BackupManifest.fromObject = function (d, q) {
                if (d instanceof $root.sma.v1.BackupManifest)
                    return d;
                if (!$util.isObject(d))
                    throw $TypeError(".sma.v1.BackupManifest: object expected");
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var m = new $root.sma.v1.BackupManifest();
                if (d.version != null) {
                    if ($Number(d.version) !== 0) {
                        m.version = d.version >>> 0;
                    }
                }
                if (d.createdAtMs != null) {
                    if (typeof d.createdAtMs === "object" ? d.createdAtMs.low || d.createdAtMs.high : $Number(d.createdAtMs) !== 0) {
                        if ($util.Long)
                            m.createdAtMs = $util.Long.fromValue(d.createdAtMs, true);
                        else if (typeof d.createdAtMs === "string")
                            m.createdAtMs = $parseInt(d.createdAtMs, 10);
                        else if (typeof d.createdAtMs === "number")
                            m.createdAtMs = d.createdAtMs;
                        else if (typeof d.createdAtMs === "object")
                            m.createdAtMs = new $util.LongBits(d.createdAtMs.low >>> 0, d.createdAtMs.high >>> 0).toNumber(true);
                    }
                }
                if (d.contacts) {
                    if (!$Array.isArray(d.contacts))
                        throw $TypeError(".sma.v1.BackupManifest.contacts: array expected");
                    m.contacts = $Array(d.contacts.length);
                    for (var i = 0; i < d.contacts.length; ++i) {
                        if (!$util.isObject(d.contacts[i]))
                            throw $TypeError(".sma.v1.BackupManifest.contacts: object expected");
                        m.contacts[i] = $root.sma.v1.BlobRef.fromObject(d.contacts[i], q + 1);
                    }
                }
                if (d.groups) {
                    if (!$Array.isArray(d.groups))
                        throw $TypeError(".sma.v1.BackupManifest.groups: array expected");
                    m.groups = $Array(d.groups.length);
                    for (var i = 0; i < d.groups.length; ++i) {
                        if (!$util.isObject(d.groups[i]))
                            throw $TypeError(".sma.v1.BackupManifest.groups: object expected");
                        m.groups[i] = $root.sma.v1.BlobRef.fromObject(d.groups[i], q + 1);
                    }
                }
                if (d.history) {
                    if (!$Array.isArray(d.history))
                        throw $TypeError(".sma.v1.BackupManifest.history: array expected");
                    m.history = $Array(d.history.length);
                    for (var i = 0; i < d.history.length; ++i) {
                        if (!$util.isObject(d.history[i]))
                            throw $TypeError(".sma.v1.BackupManifest.history: object expected");
                        m.history[i] = $root.sma.v1.BlobRef.fromObject(d.history[i], q + 1);
                    }
                }
                return m;
            };

            BackupManifest.toObject = function (m, o, q) {
                if (!o)
                    o = {};
                if (q === $undefined)
                    q = 0;
                if (q > $util.recursionLimit)
                    throw $Error("max depth exceeded");
                var d = {};
                if (o.arrays || o.defaults) {
                    d.contacts = [];
                    d.groups = [];
                    d.history = [];
                }
                if (o.defaults) {
                    d.version = 0;
                    if ($util.Long) {
                        var n = new $util.Long(0, 0, true);
                        d.createdAtMs = o.longs === $String ? n.toString() : o.longs === $Number ? n.toNumber() : typeof $BigInt !== "undefined" && o.longs === $BigInt ? n.toBigInt() : n;
                    } else
                        d.createdAtMs = o.longs === $String ? "0" : typeof $BigInt !== "undefined" && o.longs === $BigInt ? $BigInt("0") : 0;
                }
                if (m.version != null && $Object.hasOwnProperty.call(m, "version")) {
                    d.version = m.version;
                }
                if (m.createdAtMs != null && $Object.hasOwnProperty.call(m, "createdAtMs")) {
                    if (typeof $BigInt !== "undefined" && o.longs === $BigInt)
                        d.createdAtMs = typeof m.createdAtMs === "number" ? $BigInt(m.createdAtMs) : $util.Long.fromBits(m.createdAtMs.low >>> 0, m.createdAtMs.high >>> 0, true).toBigInt();
                    else if (typeof m.createdAtMs === "number")
                        d.createdAtMs = o.longs === $String ? $String(m.createdAtMs) : m.createdAtMs;
                    else
                        d.createdAtMs = o.longs === $String ? $util.Long.prototype.toString.call(m.createdAtMs) : o.longs === $Number ? new $util.LongBits(m.createdAtMs.low >>> 0, m.createdAtMs.high >>> 0).toNumber(true) : m.createdAtMs;
                }
                if (m.contacts && m.contacts.length) {
                    d.contacts = $Array(m.contacts.length);
                    for (var j = 0; j < m.contacts.length; ++j) {
                        d.contacts[j] = $root.sma.v1.BlobRef.toObject(m.contacts[j], o, q + 1);
                    }
                }
                if (m.groups && m.groups.length) {
                    d.groups = $Array(m.groups.length);
                    for (var j = 0; j < m.groups.length; ++j) {
                        d.groups[j] = $root.sma.v1.BlobRef.toObject(m.groups[j], o, q + 1);
                    }
                }
                if (m.history && m.history.length) {
                    d.history = $Array(m.history.length);
                    for (var j = 0; j < m.history.length; ++j) {
                        d.history[j] = $root.sma.v1.BlobRef.toObject(m.history[j], o, q + 1);
                    }
                }
                return d;
            };

            BackupManifest.prototype.toJSON = function() {
                return BackupManifest.toObject(this, $protobuf.util.toJSONOptions);
            };

            BackupManifest.getTypeUrl = function(prefix) {
                if (prefix === $undefined)
                    prefix = "type.googleapis.com";
                return prefix + "/sma.v1.BackupManifest";
            };

            return BackupManifest;
        })();

        return v1;
    })();

    return sma;
})();

export {
  $root as default
};
