// Looks up a single SKU from the vendor's catalog API. Written early on, before the team had
// a shared HTTP client with sane defaults, and never revisited.
async function getInventory(sku) {
  const res = await fetch(`https://api.vendor.example/v1/inventory/${sku}`)
  return res.json()
}

module.exports = { getInventory }
