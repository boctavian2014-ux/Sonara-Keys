describe('Home screen', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  it('shows the home screen root', async () => {
    await expect(element(by.id('home-screen'))).toBeVisible();
  });
});
