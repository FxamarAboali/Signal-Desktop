/* vim: ts=4:sw=4:noexpandtab:
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

$('#inbox_link').click(function(e) {
	$('#send').hide();
  $('#send_link').removeClass('selected');
	$('#inbox').show();
  $('#inbox_link').addClass('selected');
});
$('#send_link').click(function(e) {
	$('#inbox').hide();
  $('#inbox_link').removeClass('selected');
	$('#send').show();
  $('#send_link').addClass('selected');
});

textsecure.registerOnLoadFunction(function() {
	if (textsecure.storage.getUnencrypted("number_id") === undefined) {
		textsecure.platform.tabs.create("options.html");
	} else {
		$(window).bind('storage', function(e) { Whisper.Messages.fetch(); });
		Whisper.Messages.fetch();
		$('.my-number').text(textsecure.storage.getUnencrypted("number_id").split(".")[0]);
		textsecure.storage.putUnencrypted("unreadCount", 0);
		textsecure.platform.setBadgeText("");
		$("#me").click(function() {
			$('#popup_send_numbers').val($('.my-number').text());
		});

		$("#popup_send_button").click(function() {
			var numbers = [];
			var splitString = $("#popup_send_numbers").val().split(",");
			for (var i = 0; i < splitString.length; i++) {
				try {
					numbers.push(verifyNumber(splitString[i]));
				} catch (numberError) {
					//TODO
					alert(numberError);
				}
			}
			var message = Whisper.Messages.addOutgoingMessage(
				$("#popup_send_text").val(), numbers
			);
			textsecure.sendMessage(numbers, message.toProto(),
				//TODO: Handle result
				function(thing) {console.log(thing);});
		});
	}
});
