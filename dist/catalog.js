// Curated company directory, not a live exchange listing or price feed.
export const companies = [
  ['AAPL','Apple','แอปเปิล','Technology','https://investor.apple.com/'],
  ['MSFT','Microsoft','ไมโครซอฟท์','Technology','https://www.microsoft.com/en-us/Investor/'],
  ['NVDA','NVIDIA','เอ็นวิเดีย','Semiconductors','https://investor.nvidia.com/'],
  ['AMZN','Amazon','แอมะซอน','Consumer / Cloud','https://ir.aboutamazon.com/'],
  ['GOOGL','Alphabet','อัลฟาเบท กูเกิล','Communication','https://abc.xyz/investor/'],
  ['META','Meta Platforms','เมตา เฟซบุ๊ก','Communication','https://investor.atmeta.com/'],
  ['TSLA','Tesla','เทสลา','Automotive','https://ir.tesla.com/'],
  ['BRK.B','Berkshire Hathaway','เบิร์กเชียร์','Diversified','https://www.berkshirehathaway.com/'],
  ['JPM','JPMorgan Chase','เจพีมอร์แกน','Financials','https://www.jpmorganchase.com/ir'],
  ['V','Visa','วีซ่า','Payments','https://investor.visa.com/'],
  ['WMT','Walmart','วอลมาร์ท','Retail','https://stock.walmart.com/'],
  ['KO','Coca-Cola','โคคาโคล่า','Consumer staples','https://investors.coca-colacompany.com/']
].map(([symbol,name,thai,sector,url])=>({symbol,name,thai,sector,url,currency:'USD'}));
