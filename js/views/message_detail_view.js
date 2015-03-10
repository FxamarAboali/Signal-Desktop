/* vim: ts=4:sw=4:expandtab
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
(function () {
    'use strict';
    window.Whisper = window.Whisper || {};

    Whisper.MessageDetailView = Whisper.View.extend({
        className: 'message-detail',
        template: $('#message-detail').html(),
        initialize: function(options) {
            this.view = new Whisper.MessageView({model: this.model});
            this.conversation = options.conversation;
        },
        events: {
            'click .back': 'goBack',
            'verify': 'verify'
        },
        goBack: function() {
            this.trigger('back');
        },
        verify: function(number) {
            var view = new Whisper.KeyVerificationView({
                model: {
                    their_key: textsecure.storage.devices.getIdentityKeyForNumber(number),
                    your_key: textsecure.storage.devices.getIdentityKeyForNumber(
                        textsecure.utils.unencodeNumber(textsecure.storage.getUnencrypted("number_id"))[0]
                    )
                }
            });
            this.$el.hide();
            view.render().$el.insertAfter(this.el);
            this.listenTo(view, 'back', function() {
                view.remove();
                this.$el.show();
            });
        },
        contacts: function() {
            if (this.model.isIncoming()) {
                var number = this.model.get('source');
                return [this.conversation.contactCollection.get(number)];
            } else {
                return this.conversation.contactCollection.models;
            }
        },
        render: function() {
            this.$el.html(Mustache.render(this.template, {
                sent_at: moment(this.model.get('sent_at')).toString(),
                received_at: moment(this.model.get('received_at')).toString(),
                tofrom: this.model.isIncoming() ? 'From' : 'To',
                title: chrome.i18n.getMessage("messageDetail"),
                sent: chrome.i18n.getMessage("sent"),
                received: chrome.i18n.getMessage("received"),
                contacts: this.contacts().map(function(contact) {
                    return {
                        name     : contact.getTitle(),
                        avatar   : contact.get('avatar'),
                    };
                }.bind(this))
            }));
            this.view.render().$el.prependTo(this.$el.find('.message-container'));
        }
    });

})();
