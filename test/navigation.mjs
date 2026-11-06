// Exercise the same floating navigation on desktop and mobile.
export async function navigateUI(page,destination){
 const primary=page.locator(`.app-dock [data-page=${destination}]`);
 if(await primary.count())await primary.click();
 else{await page.locator('[data-mobile-more]').click();await page.locator(`#mobile-menu [data-page=${destination}]`).click();}
}

// General-flow suites choose the explicit skip action; first-use behavior has its own suite.
export async function skipFirstUse(page){
 await page.waitForSelector('body:not(.signed-out)');
 if(await page.locator('#onboarding-form').count()){
  await page.locator('[data-skip-onboarding]').click();
  await page.waitForFunction(()=>location.hash!=='#welcome');
 }
}
