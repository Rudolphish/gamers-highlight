// R2を模した最小のオブジェクトストレージ（127.0.0.1:9100）。
// 本番と同じ壊れ方を再現するため、
//   - PUT（署名付きPUT）は受ける
//   - POST（S3のPOST Object）は 501 を返し、CORSヘッダーを付けない
// ようにしている。ListObjectsV2 は /admin の使用量表示のために実装する。
import http from "node:http";

const objects = new Map(); // key -> { body, contentType, lastModified }

function xmlEscape(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function listXml(bucket) {
  const contents = [...objects.entries()]
    .map(
      ([key, o]) =>
        `<Contents><Key>${xmlEscape(key)}</Key><Size>${o.body.length}</Size>` +
        `<LastModified>${o.lastModified.toISOString()}</LastModified>` +
        `<ETag>&quot;stub&quot;</ETag><StorageClass>STANDARD</StorageClass></Contents>`
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${xmlEscape(
    bucket
  )}</Name><KeyCount>${objects.size}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:9100");
  // /<bucket>/<key...>
  const segments = url.pathname.replace(/^\//, "").split("/");
  const bucket = segments.shift() ?? "";
  const key = segments.join("/");

  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,PUT,DELETE,HEAD,OPTIONS",
    "access-control-allow-headers": "*",
    "access-control-expose-headers": "etag",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }

  // R2はPOST Objectに未対応。501を返し、**CORSヘッダーは付けない**（実物と同じ挙動）
  if (req.method === "POST" && key) {
    res.writeHead(501, { "content-type": "text/plain" });
    return res.end("Not Implemented");
  }

  if (req.method === "PUT") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const declared = req.headers["content-length"];
      if (declared !== undefined && Number(declared) !== body.length) {
        res.writeHead(400, cors);
        return res.end("length mismatch");
      }
      objects.set(key, {
        body,
        contentType: req.headers["content-type"] ?? "application/octet-stream",
        lastModified: new Date(),
      });
      res.writeHead(200, { ...cors, etag: '"stub"' });
      res.end();
    });
    return;
  }

  if (req.method === "GET" && (url.searchParams.get("list-type") === "2" || !key)) {
    const xml = listXml(bucket);
    res.writeHead(200, { ...cors, "content-type": "application/xml" });
    return res.end(xml);
  }

  if (req.method === "GET" || req.method === "HEAD") {
    const o = objects.get(key);
    if (!o) {
      res.writeHead(404, cors);
      return res.end("not found");
    }
    res.writeHead(200, { ...cors, "content-type": o.contentType, "content-length": o.body.length });
    return res.end(req.method === "HEAD" ? undefined : o.body);
  }

  if (req.method === "DELETE") {
    objects.delete(key);
    res.writeHead(204, cors);
    return res.end();
  }

  res.writeHead(405, cors);
  res.end();
});

// テスト側から中身を確認するための管理用エンドポイント
server.on("request", () => {});

// 初期オブジェクト（シードのPhotoが指す先。/admin の孤児ファイル判定に効く）
for (const key of [
  "photos/shot1.png",
  "photos/clip1.mp4",
  "photos/clip1-thumb.png",
  "photos/unsorted.png",
  "photos/outsider.png",
  "photos/orphan-not-referenced.png", // どのレコードからも参照されない＝孤児
]) {
  objects.set(key, { body: Buffer.alloc(1024), contentType: "image/png", lastModified: new Date() });
}

server.listen(9100, "127.0.0.1", () => {
  console.log("mock-r2 listening on 9100");
});
