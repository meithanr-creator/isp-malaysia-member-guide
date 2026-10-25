require "test_helper"

class NavigationTest < ActionDispatch::IntegrationTest
  test "menu removes Academy and Forum and marks Shop and Jobs as DEMO" do
    get events_path
    assert_response :success
    assert_select "nav.menu a[href*='#certification']", count: 0
    assert_select "nav.menu a[href*='#forum']", count: 0
    assert_select "nav.menu" do
      assert_select "a", text: /ISP Academy|Community forum/i, count: 0
      assert_select "a[href*='#shop']", text: /DEMO/, count: 1
      assert_select "a[href*='#jobs']", text: /DEMO/, count: 1
    end
  end
end
