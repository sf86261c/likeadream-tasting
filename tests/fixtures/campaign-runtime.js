function calculateTastingShipping(planCount, isPickup, isIsland, now) {
        if (planCount === 0) return { shippingFee: 0, shippingType: "", campaignApplied: false };
        if (isPickup) return { shippingFee: 0, shippingType: "(門市自取免運)", campaignApplied: false };
        var timestamp = now.getTime();
        var campaignActive = timestamp >= Date.parse('2026-10-01T00:00:00+08:00') && timestamp < Date.parse('2027-01-01T00:00:00+08:00');
        if (planCount >= 2 && campaignActive) {
          return {
            shippingFee: isIsland ? 100 : 0,
            shippingType: isIsland ? "(冬季搖籃曲・離島配送差額)" : "(冬季搖籃曲・本島宅配免運)",
            campaignApplied: true
          };
        }
        return { shippingFee: isIsland ? 260 : 160, shippingType: isIsland ? "(離島運費)" : "(本島運費)", campaignApplied: false };
      }
function calcTotal() {
        var productTotal = 0;
        var hasSelected = false;
        var checks = document.querySelectorAll('input[name^="plan"]:checked');
        checks.forEach(function(el) {
          productTotal += parseInt(el.getAttribute('data-price')) || 0;
          hasSelected = true;
        });

        var isPickup = document.querySelector('input[name="deliveryMethod"]:checked').value === "門市取貨";
        var addr = document.getElementById("cAddress").value;
        // 沿用行政區判定，避免「板橋區金門街」「馬祖新村」等路名誤判。
        var islands = ["澎湖縣", "金門縣", "連江縣", "綠島鄉", "蘭嶼鄉", "琉球鄉", "小琉球"];
        var isIsland = islands.some(function(keyword) { return addr.includes(keyword); });
        var shipping = calculateTastingShipping(checks.length, isPickup, isIsland, new Date());
        var shippingFee = shipping.shippingFee;
        var shippingType = shipping.shippingType;
        var needsIslandNotice = shipping.campaignApplied && isIsland;
        if (needsIslandNotice && !islandCampaignNoticeShown) {
          islandCampaignNoticeShown = true;
          alert("本活動僅限本島免運，離島配送需酌收100元差額");
        } else if (!needsIslandNotice) {
          islandCampaignNoticeShown = false;
        }

        var finalTotal = productTotal + shippingFee;
        var displayDiv = document.getElementById('totalDisplay');
        var prevText = displayDiv.innerText;
        if (hasSelected) {
          if (shipping.campaignApplied) {
            // 原運費僅供畫面對照，最終金額與送出資料仍使用實際 shippingFee。
            var originalShippingFee = isIsland ? 260 : 160;
            var campaignPriceNote = isIsland
              ? '離島配送差額：$' + shippingFee + '（原運費改以差額計收）'
              : '活動優惠：本島運費已全額折抵';
            displayDiv.innerHTML =
              '<div class="original-price">原始金額：商品 $' + productTotal + ' + <s class="waived-shipping">運費 $' + originalShippingFee + '</s></div>' +
              '<div class="campaign-price-note">' + campaignPriceNote + '</div>' +
              '<div class="final-amount">最終金額：$' + finalTotal + '</div>';
          } else {
            displayDiv.innerHTML = '<span class="price-detail">商品 ' + productTotal + ' + 運費 ' + shippingFee + '<br>' + shippingType + '</span><br>總金額：' + finalTotal;
          }
        } else {
          displayDiv.innerHTML = '總金額：$0';
        }
        if (displayDiv.innerText !== prevText) {
          displayDiv.classList.remove('bump');
          void displayDiv.offsetWidth; // 重觸發動畫
          displayDiv.classList.add('bump');
        }
        return { productTotal: productTotal, shippingFee: shippingFee, shippingType: shippingType, finalTotal: finalTotal, isPickup: isPickup, campaignApplied: shipping.campaignApplied };
      }
var islandCampaignNoticeShown = false;
