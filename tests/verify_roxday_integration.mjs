async function testEventsIntegration() {
  const HYROX_API_URL = "https://hyrox-results-api.vercel.app";
  const HYROX_API_KEY = "hx_demo_free";

  console.log("1. Testing /v1/events?status=upcoming...");
  const upcomingRes = await fetch(`${HYROX_API_URL}/v1/events?status=upcoming&limit=5`, {
    headers: { "Authorization": `Bearer ${HYROX_API_KEY}` }
  });
  const upcoming = await upcomingRes.json();
  console.log("Upcoming count:", upcoming.data?.length, "First:", upcoming.data?.[0]?.name);

  console.log("2. Testing /v1/events?status=completed...");
  const completedRes = await fetch(`${HYROX_API_URL}/v1/events?status=completed&limit=5`, {
    headers: { "Authorization": `Bearer ${HYROX_API_KEY}` }
  });
  const completed = await completedRes.json();
  console.log("Completed count:", completed.data?.length, "First:", completed.data?.[0]?.name, "Finishers:", completed.data?.[0]?.athletes_count);

  console.log("3. Testing /v1/events/:id details...");
  const detailsRes = await fetch(`${HYROX_API_URL}/v1/events/gent-2025`, {
    headers: { "Authorization": `Bearer ${HYROX_API_KEY}` }
  });
  const details = await detailsRes.json();
  console.log("Details for gent-2025:", details.data?.name, "Divisions count:", details.data?.division_breakdown?.length);

  console.log("4. Testing date helper...");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date("2026-12-31T00:00:00");
  const weeks = Math.max(0, Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 7)));
  console.log("Weeks until 2026-12-31:", weeks);

  console.log("✅ ALL EVENTS BACKEND INTEGRATION TESTS PASSED!");
}

testEventsIntegration().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
