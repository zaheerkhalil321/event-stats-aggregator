const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function main() {
  const chunks = [
    "/_next/static/immutable/chunks/3kbhynpns3hm5.js",
    "/_next/static/immutable/chunks/2tp9kvro76tq6.js",
    "/_next/static/immutable/chunks/197snrzt9u8_3.js",
    "/_next/static/immutable/chunks/3sh_-6cm7vdvf.js",
    "/_next/static/immutable/chunks/18rhfq1oj-vws.js",
    "/_next/static/immutable/chunks/34kulo4ju48yx.js",
    "/_next/static/immutable/chunks/0c-_8bqchlfw0.js",
    "/_next/static/immutable/chunks/0f5fhx__7_fwq.js",
    "/_next/static/immutable/chunks/3c5es5zuz42q-.js"
  ];
  for (const c of chunks) {
    try {
      const res = await fetch("https://hyresult.com" + c, { headers: { "User-Agent": UA } });
      const text = await res.text();
      const internalApis = text.match(/\/api\/[a-zA-Z0-9_\-\/]+/g);
      if (internalApis) {
        console.log("Internal APIs in", c, ":", [...new Set(internalApis)]);
      }
    } catch(e) {
      console.log(e.message);
    }
  }
}
main();
